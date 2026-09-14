/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SidecarManager } from './sidecarManager.ts';

function fixture(t, options = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wibe-python-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const sidecarRoot = path.join(root, 'uwa-sidecar');
	fs.mkdirSync(sidecarRoot);
	return new SidecarManager({ sidecarRoot, ...options });
}

function bundle(manager) {
	const exe = manager.bundledPython();
	fs.mkdirSync(path.dirname(exe), { recursive: true });
	return exe;
}

function forbidSystem(t, manager) {
	for (const method of ['listEnvCandidates', 'resolveViaPyLauncher', 'listInstalledCandidates', 'listPackagedCandidates']) {
		t.mock.method(manager, method, () => { throw new Error(`Unexpected system probe: ${method}`); });
	}
}

test('new machine selects bundled Python without probing PATH/py/venv', async t => {
	const manager = fixture(t);
	const exe = bundle(manager);
	forbidSystem(t, manager);
	t.mock.method(manager, 'probeInterpreter', async value => ({ ok: value === exe }));
	assert.equal(await manager.resolvePython(), exe);
});

test('explicit valid interpreter overrides bundle', async t => {
	const manager = fixture(t, { pythonPath: '/custom/python' });
	bundle(manager);
	forbidSystem(t, manager);
	const probe = t.mock.method(manager, 'probeInterpreter', async () => ({ ok: true }));
	assert.equal(await manager.resolvePython(), '/custom/python');
	assert.equal(probe.mock.callCount(), 1);
});

test('invalid override falls back to healthy bundled Python', async t => {
	const manager = fixture(t, { pythonPath: '/missing/python' });
	const exe = bundle(manager);
	forbidSystem(t, manager);
	t.mock.method(manager, 'probeInterpreter', async value => ({ ok: value === exe, reason: 'missing' }));
	assert.equal(await manager.resolvePython(), exe);
});

test('damaged bundled environment fails closed and explains repair', async t => {
	const logs = [];
	const manager = fixture(t, { log: value => logs.push(value) });
	bundle(manager);
	forbidSystem(t, manager);
	t.mock.method(manager, 'probeInterpreter', async () => ({ ok: false, reason: 'missing dependency' }));
	assert.equal(await manager.resolvePython(), undefined);
	assert.ok(logs.some(value => value.includes('重新安装')));
});

test('source checkout still supports a system interpreter', async t => {
	const manager = fixture(t);
	t.mock.method(manager, 'listEnvCandidates', () => ['/system/python']);
	t.mock.method(manager, 'probeInterpreter', async () => ({ ok: true }));
	assert.equal(await manager.resolvePython(), '/system/python');
});

test('source checkout can fall back to its own venv', async t => {
	const manager = fixture(t);
	t.mock.method(manager, 'listEnvCandidates', () => []);
	t.mock.method(manager, 'resolveViaPyLauncher', async () => []);
	t.mock.method(manager, 'listInstalledCandidates', () => []);
	t.mock.method(manager, 'probeInterpreter', async () => ({ ok: true }));
	assert.equal(await manager.resolvePython(), manager.listPackagedCandidates()[0]);
});

test('only bundled children have Python environment contamination removed', t => {
	const manager = fixture(t);
	const previous = process.env.PYTHONHOME;
	process.env.PYTHONHOME = '/invalid/conda';
	t.after(() => { if (previous === undefined) { delete process.env.PYTHONHOME; } else { process.env.PYTHONHOME = previous; } });
	assert.equal(manager.pythonEnvironment(manager.bundledPython()).PYTHONHOME, undefined);
	assert.equal(manager.pythonEnvironment('/custom/python').PYTHONHOME, '/invalid/conda');
	assert.equal(process.env.PYTHONHOME, '/invalid/conda');
	const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path');
	assert.equal(manager.pythonEnvironment(manager.bundledPython())[pathKey], process.env[pathKey]);
});

test('probe and launch arguments isolate runtime and use UTF-8 without shell quoting', t => {
	const manager = fixture(t);
	const entry = path.join('directory with spaces', '中文', 'main.py');
	assert.deepEqual(manager.pythonArguments(manager.bundledPython(), [entry]), ['-I', '-B', '-X', 'utf8', '-u', entry]);
	assert.deepEqual(manager.pythonArguments('/custom/python', [entry]), [entry]);
});

test('bundled dependency probe must not accept a missing checker', async t => {
	const manager = fixture(t);
	t.mock.method(SidecarManager, 'run', async () => ({ code: 0, stdout: '', stderr: '' }));
	const result = await manager.probeInterpreter(manager.bundledPython());
	assert.equal(result.ok, false);
	assert.match(result.reason, /check_deps.py/);
});

test('real probes both receive isolated flags and sanitized environment', async t => {
	const manager = fixture(t);
	const exe = bundle(manager);
	fs.writeFileSync(path.join(manager.opts.sidecarRoot, 'check_deps.py'), '');
	const runner = t.mock.method(SidecarManager, 'run', async () => ({ code: 0, stdout: '', stderr: '' }));
	assert.equal((await manager.probeInterpreter(exe)).ok, true);
	assert.equal(runner.mock.callCount(), 2);
	for (const call of runner.mock.calls) {
		assert.deepEqual(call.arguments[1].slice(0, 5), ['-I', '-B', '-X', 'utf8', '-u']);
		assert.ok(!Object.keys(call.arguments[4]).some(key => /^PYTHON/i.test(key)));
	}
});
