# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
"""Offline validation for the Windows sidecar runtime, including native DLL imports."""
import hashlib
import importlib
import importlib.metadata
import json
from pathlib import Path
import runpy
import sys


def verify(root):
    root = Path(root)
    lock = json.loads((root / 'build/python/dependencies-win32-x64.lock.json').read_text(encoding='utf-8'))
    requirements = (root / 'resources/uwa-sidecar/requirements.txt').read_text(encoding='utf-8')
    assert hashlib.sha256(requirements.encode('utf-8')).hexdigest() == lock['requirementsSha256'], 'Stale requirements lock'
    assert sys.version.split()[0] == lock['python'], 'Wrong Python version'
    assert sys.maxsize > 2**32 and sys.platform == 'win32', 'Wrong Python architecture'
    assert sys.flags.isolated and sys.flags.ignore_environment, 'Python must be isolated'
    assert sys.prefix == sys.base_prefix, 'A build-machine venv must not be shipped'
    from pip._vendor.packaging.requirements import Requirement
    for item in lock['packages']:
        assert importlib.metadata.version(item['name']) == item['version'], f"Wrong version: {item['name']}"
    for line in requirements.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        requirement = Requirement(line)
        if requirement.marker is None or requirement.marker.evaluate():
            version = importlib.metadata.version(requirement.name)
            assert version in requirement.specifier, f'Incompatible dependency: {requirement}'
    # Exercise native modules and paths that metadata-only checks cannot validate.
    for module in ('ssl', 'sqlite3', 'ctypes', 'pydantic_core', 'PIL.Image', 'lxml.etree',
                   'psutil', 'win32api', 'win32clipboard', 'pythoncom', 'pywintypes',
                   'uvicorn', 'httptools', 'watchfiles', 'websockets'):
        importlib.import_module(module)
    check = runpy.run_path(str(root / 'resources/uwa-sidecar/check_deps.py'))
    assert check['check_dependencies'](), 'Sidecar dependency import failed'
    # Embedded Python does not add the script directory automatically; _pth must supply it.
    importlib.import_module('app')
    print(f'PASS: Python {sys.version.split()[0]}, {len(lock["packages"])} locked dependencies and native imports')


if __name__ == '__main__':
    verify(sys.argv[1])
