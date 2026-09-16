# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
"""Opt-in network smoke: install multiple new dependencies only in a disposable copy."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dependencies
from manager import Manager
import updater


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--online', action='store_true')
    args = parser.parse_args()
    if not args.online:
        raise SystemExit('Pass --online to explicitly allow official PyPI downloads into a temporary environment')
    root = Path(__file__).resolve().parents[3]
    base = root / 'resources/python/python.exe'
    marker_before = dependencies.digest(base.parent / 'wibe-runtime.json')
    packages_before = json.loads(dependencies.run(base, ['-m', 'pip', 'list', '--format=json']).stdout)
    temporary_root = root / '.build/wibe-python'
    temporary_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='依赖更新 smoke ', dir=temporary_root) as folder:
        temporary = Path(folder)
        live = temporary / 'live'
        live.mkdir()
        (live / 'main.py').write_text('print("old")', encoding='utf-8')
        (live / 'VERSION').write_text('2.9.8', encoding='utf-8')
        state_root = temporary / 'state'
        transaction = state_root / 'transactions' / uuid.uuid4().hex
        source = transaction / 'source'
        source.mkdir(parents=True)
        (source / 'requirements.txt').write_text('humanize==4.13.0\nboltons==25.0.0\nregex==2026.9.10\n', encoding='utf-8')
        (source / 'check_deps.py').write_text('def check_dependencies():\n    import humanize, boltons, regex\n    return True\n', encoding='utf-8')
        (source / 'main.py').write_text('print("new")', encoding='utf-8')
        candidate = dependencies.prepare(base, base, source, transaction, state_root / 'wheel-cache', live)
        assert Path(candidate) != base, 'This fixture must exercise a new environment'
        assert (transaction / 'dependency-lock.json').is_file()
        manager = Manager(live, state_root, base)
        plan = manager.prepare_plan(source, transaction, [], '2.9.9', updater)
        manager.apply(transaction, plan, candidate, manager.load())
        selected = manager.select()
        assert selected['pending'] and selected['python'] == candidate
        dependencies.verify(selected['python'], live)
        result = dependencies.run(candidate, ['-c',
            "import humanize, boltons, regex; assert regex.fullmatch('a+', 'aaa', timeout=0.1); print(humanize.intcomma(12345))"])
        assert '12,345' in result.stdout
        # Simulated failed health confirmation: restore matching code + original Python.
        assert manager.recover()['rolledBack']
        assert (live / 'VERSION').read_text() == '2.9.8'
        assert manager.select()['python'] == str(base.resolve())
        # A subsequent successful candidate is only finalized after confirmation.
        manager.apply(transaction, plan, candidate, manager.load())
        assert manager.select()['pending']
        assert manager.confirm()['confirmed']
        assert (live / 'VERSION').read_text() == '2.9.9'
        assert not manager.select()['pending']
        assert dependencies.digest(base.parent / 'wibe-runtime.json') == marker_before
        packages_after = json.loads(dependencies.run(base, ['-m', 'pip', 'list', '--format=json']).stdout)
        assert packages_after == packages_before, 'Bundled environment must not be mutated'
        print('PASS: multiple new official wheels, real native imports, Unicode/space paths, rollback, confirmation, untouched base environment')
    print('PASS: disposable candidate and test project cleaned up; no live UWA/Chrome process started')


if __name__ == '__main__':
    main()
