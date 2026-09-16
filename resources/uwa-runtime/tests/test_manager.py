# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
"""Offline state-machine/rollback and dependency policy regression tests."""
from contextlib import ExitStack
from email.message import Message
import hashlib
import importlib.metadata
import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import dependencies
import manager as managed


class TransactionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.sidecar = self.root / 'resources' / 'uwa-sidecar'
        self.sidecar.mkdir(parents=True)
        self.base = self.root / 'resources' / 'python' / 'python.exe'
        self.base.parent.mkdir()
        self.base.write_bytes(b'fixture-not-an-executable')
        self.marker = self.base.parent / 'wibe-runtime.json'
        self.marker.write_text(json.dumps({'platform': 'win32-x64', 'python': '3.13.12', 'fingerprint': 'old'}))
        self.sidecar.joinpath('main.py').write_text('old')
        self.sidecar.joinpath('VERSION').write_text('2.9.8')
        self.store = self.root / 'data'
        self.manager = managed.Manager(self.sidecar, self.store, self.base)
        self.updater = SimpleNamespace(should_preserve=lambda path, patterns: False)

    def plan(self, config=False):
        tx = self.store / 'transactions' / ('a' * 32)
        source = tx / 'source'
        source.mkdir(parents=True)
        (source / 'main.py').write_text('new')
        (source / 'added.py').write_text('new file')
        (source / 'logs').mkdir()
        (source / 'logs' / 'ignored.txt').write_text('never deploy runtime data')
        if config:
            (source / 'config').mkdir()
            (source / 'config' / 'new-default.json').write_text('{"initial":true}')
        return tx, self.manager.prepare_plan(source, tx, [], '2.9.9', self.updater)

    def test_pair_is_pending_until_confirmed(self):
        tx, plan = self.plan()
        with self.manager.lock():
            self.manager.apply(tx, plan, self.base, self.manager.load())
        self.assertEqual((self.sidecar / 'main.py').read_text(), 'new')
        self.assertFalse((self.sidecar / 'logs').exists())
        self.assertTrue(self.manager.select()['pending'])
        self.assertTrue(self.manager.confirm()['confirmed'])
        self.assertEqual(self.manager.load()['phase'], 'stable')
        self.assertEqual((self.sidecar / 'VERSION').read_text(), '2.9.9')

    def test_unconfirmed_start_is_rolled_back_on_next_selection(self):
        tx, plan = self.plan()
        self.manager.apply(tx, plan, self.base, self.manager.load())
        self.manager.select()  # Simulated process dies before health confirmation.
        self.assertFalse(self.manager.select()['pending'])
        self.assertEqual(((self.sidecar / 'main.py').read_text(), (self.sidecar / 'VERSION').read_text()), ('old', '2.9.8'))
        self.assertFalse((self.sidecar / 'added.py').exists())

    def test_mid_publish_failure_restores_previous_code(self):
        tx, plan = self.plan()
        original = managed.publish
        calls = 0

        def publish(source, dest):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError('simulated disk failure')
            return original(source, dest)

        with patch.object(managed, 'publish', publish):
            with self.assertRaises(OSError):
                self.manager.apply(tx, plan, self.base, self.manager.load())
        self.assertEqual((self.sidecar / 'main.py').read_text(), 'old')
        self.assertEqual(self.manager.load()['phase'], 'stable')

    def test_durable_applying_journal_recovers_after_interruption(self):
        tx, plan = self.plan()
        state = self.manager.load()
        state.update(phase='applying', transaction=tx.name, previousPython=str(self.base))
        self.manager.save(state)
        entry = plan[0]
        managed.publish(tx / 'after' / entry['path'], self.sidecar / entry['path'])
        self.manager.select()
        self.assertEqual((self.sidecar / 'main.py').read_text(), 'old')
        self.assertFalse((self.sidecar / 'added.py').exists())

    def test_edited_config_and_runtime_data_survive_rollback(self):
        tx, plan = self.plan(config=True)
        self.manager.apply(tx, plan, self.base, self.manager.load())
        (self.sidecar / 'config' / 'new-default.json').write_text('user edit')
        (self.sidecar / 'logs').mkdir()
        (self.sidecar / 'logs' / 'current.log').write_text('user log')
        self.manager.recover()
        self.assertEqual((self.sidecar / 'config' / 'new-default.json').read_text(), 'user edit')
        self.assertEqual((self.sidecar / 'logs' / 'current.log').read_text(), 'user log')

    def test_foreign_code_change_is_not_silently_overwritten(self):
        tx, plan = self.plan()
        self.manager.apply(tx, plan, self.base, self.manager.load())
        (self.sidecar / 'main.py').write_text('external change')
        with self.assertRaises(RuntimeError):
            self.manager.recover()
        self.assertEqual((self.sidecar / 'main.py').read_text(), 'external change')
        self.assertEqual(self.manager.load()['phase'], 'recovery-failed')

    def test_new_full_install_is_not_overwritten_by_old_journal(self):
        tx, plan = self.plan()
        self.manager.apply(tx, plan, self.base, self.manager.load())
        self.marker.write_text(json.dumps({'platform': 'win32-x64', 'fingerprint': 'new'}))
        (self.sidecar / 'main.py').write_text('new full Wibe installation')
        replacement = managed.Manager(self.sidecar, self.store, self.base)
        self.assertFalse(replacement.select()['pending'])
        self.assertEqual((self.sidecar / 'main.py').read_text(), 'new full Wibe installation')

    def test_concurrent_update_is_rejected(self):
        with self.manager.lock():
            with self.assertRaises(RuntimeError):
                with self.manager.lock():
                    self.fail('second lock must not be acquired')

    def test_foreign_state_and_escaping_paths_are_rejected(self):
        for relative in ('../escape', '/escape', 'C:/escape', 'folder/../../escape', 'folder/file:stream', 'folder/file.', 'NUL', 'folder/COM1.txt', 'folder/bad*name'):
            with self.subTest(relative=relative), self.assertRaises(ValueError):
                managed.safe_path(self.sidecar, relative)
        state = self.manager.load()
        state['activePython'] = str(self.root / 'outside.exe')
        self.manager.save(state)
        with self.assertRaises(ValueError):
            self.manager.select()

    def test_archive_traversal_and_duplicates_rejected(self):
        for entries in ([('../outside', 'bad')], [('MAIN.py', 'a'), ('main.py', 'b')]):
            with tempfile.TemporaryDirectory() as directory:
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, 'w') as archive:
                    for name, content in entries:
                        archive.writestr(name, content)
                buffer.seek(0)
                with zipfile.ZipFile(buffer) as archive, self.assertRaises(ValueError):
                    managed.extract_archive(archive, Path(directory))

    def test_launcher_keeps_update_hooks_outside_replaced_main(self):
        import updater
        with ExitStack() as stack:
            stack.enter_context(patch.object(updater, 'update_to_version'))
            stack.enter_context(patch.object(updater, 'check_and_update'))
            stack.enter_context(patch.dict(sys.modules, {'plugin_host': SimpleNamespace(boot=lambda: None)}))
            entry = stack.enter_context(patch.object(managed.runpy, 'run_path'))
            update = stack.enter_context(patch.object(self.manager, 'update', return_value=True))
            arguments = list(sys.argv)
            stack.callback(lambda: setattr(sys, 'argv', arguments))
            self.manager.launch()
            self.assertTrue(updater.update_to_version('3.0', preserve=[]))
            self.assertTrue(updater.check_and_update(force=True, preserve=[]))
            self.assertEqual(update.call_args_list[0].args, ('3.0', None, []))
            self.assertEqual(update.call_args_list[1].args, (None, None, [], True))
            entry.assert_called_once_with(str(self.sidecar / 'main.py'), run_name='__main__')

    def test_update_routes_prepare_environment_before_live_writes(self):
        import updater
        for tag in (None, '2.9.9'):
            with self.subTest(tag=tag), ExitStack() as stack:
                buffer = io.BytesIO()
                with zipfile.ZipFile(buffer, 'w') as archive:
                    archive.writestr('requirements.txt', 'new-package>=1')
                    archive.writestr('check_deps.py', 'def check_dependencies(): return True')
                    archive.writestr('main.py', 'print("new")')
                payload = buffer.getvalue()
                stack.enter_context(patch.object(updater, 'fetch_release_by_tag', return_value={'tag_name': '2.9.9'}))
                stack.enter_context(patch.object(updater, 'fetch_latest_release', return_value={'tag_name': '2.9.9'}))
                stack.enter_context(patch.object(updater, 'get_current_version', return_value='2.9.8'))
                stack.enter_context(patch.object(updater, 'get_release_zip_asset', return_value={
                    'browser_download_url': 'https://example.invalid/release.zip',
                    'digest': 'sha256:' + hashlib.sha256(payload).hexdigest()}))
                stack.enter_context(patch.object(updater, 'download_file_robust', side_effect=lambda url, dest, **kw: bool(dest.write_bytes(payload))))
                prepare = stack.enter_context(patch.object(dependencies, 'prepare', side_effect=RuntimeError('no compatible wheel')))
                with self.assertRaisesRegex(RuntimeError, 'no compatible wheel'):
                    self.manager.update(tag=tag, preserve=[])
                self.assertEqual(prepare.call_count, 1)
                self.assertEqual(((self.sidecar / 'main.py').read_text(), self.manager.load()['phase']), ('old', 'stable'))


class DependencyPolicyTests(unittest.TestCase):
    def test_directives_and_bootstrap_overrides_rejected(self):
        for content in ('', '-r another.txt', '--index-url https://example.invalid',
                        'dep @ https://example.invalid/dep.whl', 'pip>=1', 'dep \\'):
            with self.subTest(content=content), self.assertRaises(ValueError):
                dependencies.requirements(content)

    def test_markers_extras_and_transitive_versions(self):
        def dist(version, requires=(), extras=()):
            metadata = Message()
            for extra in extras:
                metadata['Provides-Extra'] = extra
            return SimpleNamespace(version=version, metadata=metadata, requires=requires)
        packages = {'parent': dist('1', ['child>=2; extra == "standard"'], ['standard']), 'child': dist('1')}
        with patch.object(importlib.metadata, 'distribution', side_effect=packages.__getitem__):
            dependencies.check_requirements('parent\nmissing; python_version < "1.0"')
            with self.assertRaises(ValueError):
                dependencies.check_requirements('parent[standard]')
            packages['child'] = dist('2', ['parent[standard]'])
            dependencies.check_requirements('parent[standard]')

    def test_artifact_policy_is_wheel_only_and_official_host(self):
        base = {'metadata': {'name': 'example', 'version': '1.0'}, 'download_info': {
            'url': 'https://files.pythonhosted.org/packages/example-1.0-py3-none-any.whl',
            'archive_info': {'hashes': {'sha256': 'a' * 64}}}}
        self.assertEqual(dependencies._artifact(base)['name'], 'example')
        for url in ('http://files.pythonhosted.org/x.whl', 'https://evil.invalid/x.whl',
                    'https://files.pythonhosted.org/x.tar.gz', 'https://files.pythonhosted.org:8443/x.whl'):
            with self.subTest(url=url):
                item = json.loads(json.dumps(base))
                item['download_info']['url'] = url
                with self.assertRaises(ValueError):
                    dependencies._artifact(item)

    def test_cached_wheel_hash_is_rechecked(self):
        with tempfile.TemporaryDirectory() as folder:
            cache = Path(folder)
            artifact = {'sha256': hashlib.sha256(b'good').hexdigest(), 'filename': 'x.whl',
                        'url': 'https://files.pythonhosted.org/x.whl', 'name': 'x'}
            target = cache / (artifact['sha256'] + '-x.whl')
            target.write_bytes(b'good')
            with patch.object(dependencies.urllib.request, 'build_opener', side_effect=AssertionError('must use valid cache')):
                self.assertEqual(dependencies.download(artifact, cache), target)
            target.write_bytes(b'corrupt')
            with patch.object(dependencies.urllib.request, 'build_opener', side_effect=RuntimeError('cache rejected')):
                with self.assertRaisesRegex(RuntimeError, 'cache rejected'):
                    dependencies.download(artifact, cache)

    def test_pip_environment_does_not_inherit_user_package_settings(self):
        with patch.dict(os.environ, {'PYTHONPATH': 'bad', 'PIP_INDEX_URL': 'https://evil.invalid'}):
            env = dependencies.environment()
            self.assertNotIn('PYTHONPATH', env)
            self.assertNotIn('PIP_INDEX_URL', env)
            self.assertEqual(env['PIP_CONFIG_FILE'], os.devnull)


if __name__ == '__main__':
    unittest.main()
