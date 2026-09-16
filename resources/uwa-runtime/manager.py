# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
"""Wibe-owned transactional UWA updater. Never distributed inside an upstream ZIP."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import runpy
import shutil
import stat
import sys
import threading
import uuid
import zipfile

# -I deliberately omits script directories. Only add this shipped, Wibe-owned one.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import dependencies

_THREAD_LOCK = threading.Lock()
_DATA = {'.git', '.env', 'chrome_profile', 'venv', '.venv', 'logs', 'temp', 'tmp',
         'scratch', 'download_images', 'image', 'output', 'node_modules', '.update_temp',
         'plugin_host', 'uwa-plugins', 'wibe_update_guard.py'}


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def safe_path(root, relative):
    path = PurePosixPath(relative)
    if not path.parts or path.is_absolute() or any(part in ('..', '.') for part in path.parts):
        raise ValueError('Unsafe transaction path')
    for part in path.parts:
        device = part.split('.')[0].casefold()
        if (any(ord(char) < 32 or char in ':\\<>\"|?*' for char in part) or part.endswith((' ', '.'))
                or device in {'con', 'prn', 'aux', 'nul', *(f'com{i}' for i in range(1, 10)), *(f'lpt{i}' for i in range(1, 10))}):
            raise ValueError('Unsafe Windows path')
    target = root.joinpath(*path.parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError('Path escapes managed directory')
    current = root
    for part in path.parts:
        current /= part
        if current.is_symlink() or (hasattr(current, 'is_junction') and current.is_junction()):
            raise ValueError('Links are not allowed in managed code paths')
    return target


def file_hash(path):
    if not path.exists():
        return None
    if not path.is_file():
        raise ValueError(f'Expected regular file: {path.name}')
    return dependencies.digest(path)


def publish(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name('.' + destination.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with source.open('rb') as src, temporary.open('wb') as dst:
            shutil.copyfileobj(src, dst)
            dst.flush()
            os.fsync(dst.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def extract_archive(archive, destination):
    members = archive.infolist()
    if not members or len(members) > 20_000 or sum(item.file_size for item in members) > 1024 ** 3:
        raise ValueError('Update archive exceeds size/count limit')
    seen = set()
    for item in members:
        relative = item.filename.replace('\\', '/').rstrip('/')
        target = safe_path(destination, relative)
        key = target.relative_to(destination).as_posix().casefold()
        if key in seen or stat.S_ISLNK(item.external_attr >> 16):
            raise ValueError('Duplicate or linked archive member')
        seen.add(key)
        if item.file_size > 1024 ** 2 and item.file_size / max(item.compress_size, 1) > 200:
            raise ValueError('Update archive compression ratio exceeds limit')
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(item) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)


class Manager:
    def __init__(self, sidecar, state_root, base_python):
        self.sidecar = Path(sidecar).resolve()
        self.root = Path(state_root).resolve()
        self.base_python = Path(base_python).resolve()
        self.state_file = self.root / 'state.json'
        marker = json.loads((self.base_python.parent / 'wibe-runtime.json').read_text(encoding='utf-8'))
        if marker.get('platform') != 'win32-x64':
            raise ValueError('Only the Wibe Windows x64 runtime is supported')
        product = self.sidecar.parent.parent / 'product.json'
        self.base_key = hashlib.sha256((str(marker.get('fingerprint', '')) +
                                       (dependencies.digest(product) if product.is_file() else '')).encode()).hexdigest()

    @contextmanager
    def lock(self):
        if not _THREAD_LOCK.acquire(blocking=False):
            raise RuntimeError('A managed UWA update is already running')
        stream = None
        locked = False
        try:
            self.root.mkdir(parents=True, exist_ok=True)
            stream = (self.root / 'update.lock').open('a+b')
            stream.seek(0, 2)
            if stream.tell() == 0:
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            if os.name == 'nt':
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            locked = True
            yield
        finally:
            if stream:
                if locked:
                    stream.seek(0)
                    if os.name == 'nt':
                        import msvcrt
                        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                    else:
                        import fcntl
                        fcntl.flock(stream, fcntl.LOCK_UN)
                stream.close()
            _THREAD_LOCK.release()

    def load(self):
        if not self.state_file.exists():
            return {'schema': 1, 'origin': str(self.sidecar), 'baseKey': self.base_key,
                    'phase': 'stable', 'activePython': str(self.base_python)}
        state = json.loads(self.state_file.read_text(encoding='utf-8'))
        if state.get('schema') != 1 or os.path.normcase(str(state.get('origin'))) != os.path.normcase(str(self.sidecar)):
            raise ValueError('Managed runtime state does not match this Wibe installation')
        if state.get('baseKey') != self.base_key:
            # A full Wibe install supersedes an old UWA transaction; never restore
            # old code over that newly installed product.
            print('[wibe-update] new Wibe baseline detected; selecting its bundled runtime')
            state = {'schema': 1, 'origin': str(self.sidecar), 'baseKey': self.base_key,
                     'phase': 'stable', 'activePython': str(self.base_python),
                     'previousBaseline': state.get('baseKey')}
            self.save(state)
        self.validate_python(state['activePython'])
        if state.get('transaction'):
            self.transaction(state)
        return state

    def save(self, state):
        atomic_json(self.state_file, state)

    def transaction(self, state):
        identifier = state['transaction']
        if not isinstance(identifier, str) or len(identifier) != 32 or any(c not in '0123456789abcdef' for c in identifier):
            raise ValueError('Invalid transaction identifier')
        return safe_path(self.root, 'transactions/' + identifier)

    def validate_python(self, python):
        path = Path(python).resolve()
        if path == self.base_python:
            return path
        relative = path.relative_to(self.root).as_posix()
        candidate = safe_path(self.root, relative)
        parts = PurePosixPath(relative).parts
        if len(parts) != 4 or parts[0] != 'transactions' or parts[2:] != ('python', 'python.exe'):
            raise ValueError('Invalid managed Python path')
        return candidate

    def rollback(self, state):
        if state['phase'] not in ('applying', 'pending', 'starting', 'recovery-failed'):
            return False
        transaction = self.transaction(state)
        plan = json.loads((transaction / 'plan.json').read_text(encoding='utf-8'))
        try:
            for entry in reversed(plan):
                target = safe_path(self.sidecar, entry['path'])
                current = file_hash(target)
                if current == entry['before']:
                    continue
                if current != entry['after']:
                    if entry['path'].startswith('config/'):
                        print(f"[wibe-update] preserving subsequently edited configuration: {entry['path']}")
                        continue
                    raise RuntimeError(f"Code changed outside transaction; manual recovery needed: {entry['path']}")
                if entry['before'] is None:
                    target.unlink()
                else:
                    before = safe_path(transaction / 'before', entry['path'])
                    if dependencies.digest(before) != entry['before']:
                        raise ValueError('Recovery snapshot hash mismatch')
                    publish(before, target)
            state['activePython'] = state['previousPython']
            self.validate_python(state['activePython'])
            state['phase'] = 'stable'
            state['lastRollback'] = state.pop('transaction')
            state.pop('previousPython', None)
            self.save(state)
            print('[wibe-update] restored previous code and Python; user data directories were not rolled back')
            return True
        except Exception:
            state['phase'] = 'recovery-failed'
            self.save(state)
            raise

    def select(self):
        with self.lock():
            state = self.load()
            if state['phase'] in ('applying', 'starting', 'recovery-failed'):
                self.rollback(state)
            if state['phase'] == 'pending':
                state['phase'] = 'starting'
                self.save(state)
            return {'python': state['activePython'], 'pending': state['phase'] == 'starting'}

    def confirm(self):
        with self.lock():
            state = self.load()
            if state['phase'] == 'starting':
                state['phase'] = 'stable'
                state['lastGoodTransaction'] = state.pop('transaction')
                state.pop('previousPython', None)
                self.save(state)
            return {'confirmed': state['phase'] == 'stable'}

    def recover(self):
        with self.lock():
            state = self.load()
            return {'rolledBack': self.rollback(state)}

    def prepare_plan(self, source, transaction, preserve, version, updater):
        after_root = transaction / 'after'
        before_root = transaction / 'before'
        plan = []
        seen = set()
        for source_file in source.rglob('*'):
            if source_file.is_dir():
                continue
            relative = source_file.relative_to(source).as_posix()
            parts = PurePosixPath(relative).parts
            first = parts[0].casefold()
            if (first in _DATA or first.startswith('backup_') or first.startswith('.env')
                    or '.local' in source_file.name or first == 'version'
                    or updater.should_preserve(Path(relative), preserve)):
                continue
            target = safe_path(self.sidecar, relative)
            # Keep local runtime configuration except the two upstream merge formats.
            merge = relative in ('config/sites.json', 'config/commands.json')
            if first == 'config' and target.exists() and not merge:
                continue
            key = relative.casefold()
            if key in seen:
                raise ValueError('Case-colliding update paths')
            seen.add(key)
            after = safe_path(after_root, relative)
            after.parent.mkdir(parents=True, exist_ok=True)
            old_hash = file_hash(target)
            if merge and old_hash is not None:
                shutil.copy2(target, after)
                if relative == 'config/sites.json':
                    updater.merge_sites_file(source_file, after)
                else:
                    updater.merge_command_file(source_file, after)
            else:
                shutil.copy2(source_file, after)
            if old_hash == dependencies.digest(after):
                continue
            plan.append({'path': relative, 'before': old_hash, 'after': dependencies.digest(after)})
        version_file = after_root / 'VERSION'
        version_file.parent.mkdir(parents=True, exist_ok=True)
        version_file.write_text(version, encoding='utf-8')
        plan.append({'path': 'VERSION', 'before': file_hash(self.sidecar / 'VERSION'),
                     'after': dependencies.digest(version_file)})
        for entry in plan:
            target = safe_path(self.sidecar, entry['path'])
            if file_hash(target) != entry['before']:
                raise RuntimeError(f"File changed while preparing update: {entry['path']}")
            if entry['before'] is not None:
                before = safe_path(before_root, entry['path'])
                before.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, before)
                if dependencies.digest(before) != entry['before']:
                    raise RuntimeError('File changed while snapshotting')
        atomic_json(transaction / 'plan.json', plan)
        return plan

    def apply(self, transaction, plan, python, state):
        state.update(phase='applying', transaction=transaction.name,
                     previousPython=state['activePython'])
        self.save(state)  # Durable recovery journal BEFORE the first live write.
        try:
            for entry in plan:
                target = safe_path(self.sidecar, entry['path'])
                if file_hash(target) != entry['before']:
                    raise RuntimeError(f"Concurrent file change: {entry['path']}")
                publish(safe_path(transaction / 'after', entry['path']), target)
            state.update(phase='pending', activePython=str(python))
            self.save(state)
        except Exception:
            self.rollback(state)
            raise

    def update(self, tag=None, repo=None, preserve=None, force=False):
        import updater
        with self.lock():
            state = self.load()
            if state['phase'] != 'stable':
                raise RuntimeError('Previous update awaits startup confirmation/recovery')
            repo = repo or os.getenv('GITHUB_REPO', updater.DEFAULT_REPO)
            # Only the configured UWA repository is a code source; dependency
            # resolution independently restricts all artifacts to official PyPI.
            release = (updater.fetch_release_by_tag(repo, tag) if tag is not None
                       else updater.fetch_latest_release(repo))
            if not release:
                raise RuntimeError('Could not fetch target release')
            version = updater.normalize_version(str(release.get('tag_name') or tag or ''))
            if not version:
                raise ValueError('Release has no version')
            if tag is None and not force and updater.compare_versions(updater.get_current_version(), version) >= 0:
                return False
            asset = updater.get_release_zip_asset(release, repo)
            if not asset:
                raise ValueError('Release has no verified ZIP asset')
            sha256 = str(asset.get('digest', '')).removeprefix('sha256:')
            if len(sha256) != 64 or any(c not in '0123456789abcdef' for c in sha256):
                raise ValueError('Release has no trusted SHA256')
            transaction = self.root / 'transactions' / uuid.uuid4().hex
            transaction.mkdir(parents=True)
            archive_path = transaction / 'release.zip'
            try:
                if not updater.download_file_robust(asset['browser_download_url'], archive_path, expected_sha256=sha256):
                    raise RuntimeError('Release download failed')
                if dependencies.digest(archive_path) != sha256:
                    raise ValueError('Release SHA256 mismatch')
                extracted = transaction / 'source'
                with zipfile.ZipFile(archive_path) as archive:
                    members = archive.infolist()
                    names = [member.filename.replace('\\', '/').casefold() for member in members]
                    if len(names) != len(set(names)):
                        raise ValueError('Duplicate/case-colliding ZIP members')
                    extract_archive(archive, extracted)
                roots = list(extracted.iterdir())
                source = roots[0] if len(roots) == 1 and roots[0].is_dir() else extracted
                for filename in ('requirements.txt', 'check_deps.py', 'main.py'):
                    if not (source / filename).is_file():
                        raise ValueError(f'Release is missing {filename}')
                if (source / 'requirements.txt').stat().st_size > 128 * 1024:
                    raise ValueError('Requirements manifest too large')
                # Fail before publishing syntax-incompatible Python code.
                for script in source.rglob('*.py'):
                    if script.stat().st_size > 16 * 1024 * 1024:
                        raise ValueError('Python source file exceeds size limit')
                    compile(script.read_bytes(), str(script.relative_to(source)), 'exec')
                python = dependencies.prepare(self.base_python, Path(state['activePython']), source,
                                              transaction, self.root / 'wheel-cache', self.sidecar)
                self.validate_python(python)
                if preserve is None:
                    configured = os.getenv('UPDATE_PRESERVE', '')
                    patterns = ([p.strip() for p in configured.split(',')] if configured else
                                updater.load_update_preserve_settings().get('selected_patterns', updater.DEFAULT_PRESERVE))
                    preserve = updater.build_effective_preserve_patterns(patterns)
                # Code and requirements cannot be independently preserved: that
                # would destroy the code/environment pairing. Refuse rather than mix.
                for item in source.rglob('*'):
                    if item.is_file():
                        relative = item.relative_to(source)
                        if (item.suffix == '.py' or relative.as_posix() == 'requirements.txt') and updater.should_preserve(relative, preserve):
                            raise ValueError('Managed updates cannot preserve code or requirements separately')
                plan = self.prepare_plan(source, transaction, preserve, version, updater)
                self.apply(transaction, plan, python, state)
                print(f'[wibe-update] {version} staged successfully; restart will confirm or roll back this transaction')
                return True
            except Exception as exc:
                # Failed preparation never modifies the live project. Retain only
                # an audit error; immutable old environments remain selectable.
                atomic_json(transaction / 'failure.json', {'error': str(exc)})
                raise RuntimeError(f'Wibe 更新失败，未确认的新版本不会成为可用版本：{exc}') from exc

    def launch(self):
        import updater
        updater.update_to_version = lambda tag, repo=None, preserve=None: self.update(tag, repo, preserve)
        updater.check_and_update = lambda repo=None, force=False, preserve=None: self.update(None, repo, preserve, force)
        print('[wibe-update] transactional dependency updates enabled')
        # Upstream replaces main.py and may remove Wibe's plugin boot. Load it here
        # from the preserved Wibe plugin directory (boot is idempotent).
        try:
            from plugin_host import boot
            boot()
        except Exception as exc:
            print(f'[wibe-update] plugin boot warning: {exc}')
        entry = self.sidecar / 'main.py'
        sys.argv = [str(entry)]
        runpy.run_path(str(entry), run_name='__main__')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('select', 'confirm', 'rollback', 'launch'))
    parser.add_argument('--sidecar-root', required=True)
    parser.add_argument('--state-root', required=True)
    parser.add_argument('--base-python', required=True)
    args = parser.parse_args()
    manager = Manager(args.sidecar_root, args.state_root, args.base_python)
    if args.action == 'launch':
        manager.launch()
    else:
        result = {'select': manager.select, 'confirm': manager.confirm, 'rollback': manager.recover}[args.action]()
        print(json.dumps(result))


if __name__ == '__main__':
    main()
