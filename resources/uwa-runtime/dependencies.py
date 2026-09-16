# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
"""Prepare immutable, wheel-only Python environments for managed UWA updates."""
from collections import deque
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request
from urllib.parse import urlparse, unquote


MAX_WHEEL_BYTES = 512 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def environment():
    env = {key: value for key, value in os.environ.items()
           if not key.upper().startswith(('PYTHON', 'PIP_'))}
    env['PIP_CONFIG_FILE'] = os.devnull
    return env


def run(python, args, timeout=180, check=True):
    result = subprocess.run([str(python), '-I', '-B', '-X', 'utf8', *args],
                            stdin=subprocess.DEVNULL, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', env=environment(),
                            timeout=timeout, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if check and result.returncode:
        raise RuntimeError(f'Python dependency preparation failed:\n{(result.stdout + result.stderr)[-8000:]}')
    return result


def requirements(content):
    from pip._vendor.packaging.requirements import Requirement
    parsed = []
    for raw in content.splitlines():
        line = re.split(r'\s+#', raw.strip(), maxsplit=1)[0].strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('-') or line.endswith('\\'):
            raise ValueError(f'Unsupported requirements directive: {line}')
        item = Requirement(line)
        if item.url:
            raise ValueError(f'Direct URL dependencies are not allowed: {item.name}')
        if item.name.lower().replace('_', '-') in ('pip', 'wibe-runtime'):
            raise ValueError(f'The release cannot replace the runtime bootstrap: {item.name}')
        parsed.append(item)
    if not parsed:
        raise ValueError('Empty requirements.txt')
    return parsed


def check_requirements(content):
    from pip._vendor.packaging.requirements import Requirement
    from pip._vendor.packaging.utils import canonicalize_name
    pending = deque((item, ('',)) for item in requirements(content))
    seen = set()
    while pending:
        item, parent_extras = pending.popleft()
        if item.marker and not any(item.marker.evaluate({'extra': extra}) for extra in parent_extras):
            continue
        if item.url:
            raise ValueError(f'Direct URL dependency: {item.name}')
        dist = importlib.metadata.distribution(item.name)
        if not item.specifier.contains(dist.version, prereleases=True):
            raise ValueError(f'Incompatible dependency: {item}; installed {dist.version}')
        extras = frozenset(canonicalize_name(extra) for extra in item.extras)
        provided = {canonicalize_name(extra) for extra in dist.metadata.get_all('Provides-Extra', [])}
        if not extras.issubset(provided):
            raise ValueError(f'Unsupported extras: {item}')
        key = (canonicalize_name(item.name), extras)
        if key in seen:
            continue
        seen.add(key)
        if len(seen) > 2048:
            raise ValueError('Dependency graph exceeds limit')
        pending.extend((Requirement(child), ('', *sorted(extras))) for child in (dist.requires or []))


def set_path(runtime, sidecar):
    paths = list(Path(runtime).glob('python*._pth'))
    if len(paths) != 1:
        raise ValueError('Expected exactly one embeddable Python _pth file')
    tag = paths[0].stem
    paths[0].write_text(f'{tag}.zip\n.\nLib/site-packages\n{Path(sidecar).resolve()}\nimport site\n', encoding='utf-8')


def verify(python, source):
    # Execute only after the user requested this verified release. No live server
    # is started here; check_deps imports the target's declared runtime packages.
    run(python, [str(Path(__file__).resolve()), 'verify', str(source)], timeout=120)
    run(python, ['-m', 'pip', '--isolated', '--disable-pip-version-check', 'check'], timeout=60)


def _artifact(item):
    info = item['download_info']
    url = info['url']
    parsed = urlparse(url)
    filename = unquote(parsed.path.rsplit('/', 1)[-1])
    sha256 = info['archive_info']['hashes']['sha256']
    if (parsed.scheme != 'https' or parsed.hostname != 'files.pythonhosted.org'
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or not re.fullmatch(r'[A-Za-z0-9_.+!-]+\.whl', filename)
            or not re.fullmatch(r'[a-f0-9]{64}', sha256)):
        raise ValueError('Resolver returned an unapproved wheel URL or hash')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', item['metadata']['name']) or not re.fullmatch(r'[A-Za-z0-9_.+!-]+', item['metadata']['version']):
        raise ValueError('Invalid artifact name or version')
    if item['metadata']['name'].lower() == 'pip':
        raise ValueError('Target dependencies cannot replace bootstrap pip')
    return {'name': item['metadata']['name'], 'version': item['metadata']['version'],
            'url': url, 'sha256': sha256, 'filename': filename}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Wheel download redirects are not allowed')


def download(artifact, cache):
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / (artifact['sha256'] + '-' + artifact['filename'])
    if target.is_file() and digest(target) == artifact['sha256']:
        if target.stat().st_size > MAX_WHEEL_BYTES:
            raise ValueError('Cached wheel is too large')
        return target
    temporary = target.with_name(target.name + '.partial')
    try:
        opener = urllib.request.build_opener(_NoRedirect())
        with opener.open(artifact['url'], timeout=60) as response, temporary.open('wb') as stream:
            count = 0
            for block in iter(lambda: response.read(1024 * 1024), b''):
                count += len(block)
                if count > MAX_WHEEL_BYTES:
                    raise ValueError('Wheel exceeds size limit')
                stream.write(block)
        if digest(temporary) != artifact['sha256']:
            raise ValueError(f'Wheel SHA256 mismatch: {artifact["name"]}')
        os.replace(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def prepare(base_python, current_python, source, transaction, cache, sidecar):
    """Reuse a compatible immutable runtime, otherwise resolve into a clean sibling."""
    content = (source / 'requirements.txt').read_text(encoding='utf-8-sig')
    desired = requirements(content)
    try:
        verify(current_python, source)
        print('[wibe-update] existing environment satisfies target requirements')
        return str(current_python)
    except (RuntimeError, subprocess.TimeoutExpired):
        pass

    runtime = transaction / 'python'
    base = Path(base_python).parent
    # Copy the trusted interpreter, not an old environment with potentially removed
    # packages. pip (including its vendored parser) is the only bootstrap package.
    shutil.copytree(base, runtime, ignore=shutil.ignore_patterns('Lib', 'Scripts', '__pycache__'))
    site = runtime / 'Lib' / 'site-packages'
    site.mkdir(parents=True)
    base_site = base / 'Lib' / 'site-packages'
    for item in base_site.iterdir():
        if item.name == 'pip' or (item.name.startswith('pip-') and item.name.endswith('.dist-info')):
            shutil.copytree(item, site / item.name)
    python = runtime / 'python.exe'
    set_path(runtime, source)
    pip = ['-m', 'pip', '--isolated', '--disable-pip-version-check', '--no-cache-dir']
    report = transaction / 'resolve-report.json'
    # Prefer existing versions; release constraints may require relaxing these
    # preferences. Both resolutions occur only in the disposable candidate.
    installed = json.loads(run(current_python, [*pip, 'list', '--format=json']).stdout)
    from pip._vendor.packaging.utils import canonicalize_name
    direct = {canonicalize_name(item.name): item for item in desired}
    pins = []
    for item in installed:
        name = canonicalize_name(item['name'])
        if name == 'pip':
            continue
        req = direct.get(name)
        if req is None or req.specifier.contains(item['version'], prereleases=True):
            pins.append(f"{item['name']}=={item['version']}")
    constraints = transaction / 'prefer-current.txt'
    constraints.write_text('\n'.join(pins) + '\n', encoding='utf-8')
    args = [*pip, 'install', '--dry-run', '--ignore-installed', '--only-binary=:all:',
            '--index-url', 'https://pypi.org/simple', '--retries', '2', '--timeout', '30',
            '--report', str(report), '-r', str(source / 'requirements.txt')]
    print('[wibe-update] resolving target dependencies (official PyPI wheels only)')
    first = run(python, [*args, '-c', str(constraints)], timeout=900, check=False)
    if first.returncode:
        print('[wibe-update] existing version preferences cannot be retained; resolving target constraints')
        run(python, args, timeout=900)
    resolved = json.loads(report.read_text(encoding='utf-8'))
    artifacts = [_artifact(item) for item in resolved['install']]
    if not artifacts or len(artifacts) > 512:
        raise ValueError('Unexpected dependency count')
    wheels = transaction / 'wheels'
    wheels.mkdir()
    total = 0
    previous = {canonicalize_name(item['name']): item['version'] for item in installed}
    for item in artifacts:
        old = previous.get(canonicalize_name(item['name']))
        if old != item['version']:
            print(f"[wibe-update] dependency {item['name']}: {old or '(new)'} -> {item['version']}")
        cached = download(item, cache)
        total += cached.stat().st_size
        if total > MAX_TOTAL_BYTES:
            raise ValueError('Dependency downloads exceed total size limit')
        shutil.copy2(cached, wheels / item['filename'])
    lock = transaction / 'requirements.lock'
    lock.write_text('\n'.join(f"{x['name']}=={x['version']} --hash=sha256:{x['sha256']}" for x in artifacts) + '\n', encoding='utf-8')
    run(python, [*pip, 'install', '--no-index', '--find-links', str(wheels), '--only-binary=:all:',
                 '--require-hashes', '--no-deps', '--no-compile', '--no-warn-script-location', '-r', str(lock)], timeout=900)
    verify(python, source)
    shutil.rmtree(runtime / 'Scripts', ignore_errors=True)
    set_path(runtime, sidecar)
    manifest = {'schema': 1, 'python': json.loads((base / 'wibe-runtime.json').read_text(encoding='utf-8'))['python'],
                'requirementsSha256': hashlib.sha256(content.encode()).hexdigest(), 'packages': artifacts}
    (runtime / 'wibe-runtime.json').write_text(json.dumps({'platform': 'win32-x64',
        'python': manifest['python'], 'managed': True, 'requirementsSha256': manifest['requirementsSha256']}), encoding='utf-8')
    (transaction / 'dependency-lock.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    print('[wibe-update] candidate environment verified; active Python was not modified')
    return str(python)


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != 'verify':
        raise SystemExit('Expected: dependencies.py verify SOURCE')
    source = Path(sys.argv[2])
    check_requirements((source / 'requirements.txt').read_text(encoding='utf-8-sig'))
    import runpy
    check = runpy.run_path(str(source / 'check_deps.py'))
    if not check['check_dependencies']():
        raise SystemExit('Target dependency imports failed')
    print('[wibe-update] requirements, extras and target imports verified')
