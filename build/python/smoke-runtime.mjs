/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.platform, 'win32', 'Run this smoke test on Windows x64');
await fs.mkdir(path.join(root, '.build/wibe-python'), { recursive: true });
const temporary = await fs.mkdtemp(path.join(root, '.build/wibe-python/relocation-'));
const relocated = path.join(temporary, '新机器 with spaces');
const python = path.join(relocated, 'resources/python/python.exe');
const sidecar = path.join(relocated, 'resources/uwa-sidecar');
const env = { ...process.env };
for (const key of Object.keys(env)) {
	if (/^(PATH|PYTHON.*)$/i.test(key)) { delete env[key]; }
}
// No system Python, a broken Conda-style environment, and an unrelated working directory.
env.PATH = '';
env.PYTHONHOME = path.join(temporary, 'nonexistent-system-python');
env.PYTHONPATH = path.join(temporary, 'untrusted-user-site');
env.PYTHONUSERBASE = env.PYTHONPATH;
env.PYTHONIOENCODING = 'ascii';

function run(args, expectSuccess = true) {
	const result = spawnSync(python, ['-I', '-B', '-X', 'utf8', '-u', ...args], {
		cwd: temporary, env, encoding: 'utf8', windowsHide: true, timeout: 60_000
	});
	if (result.error) { throw result.error; }
	if (expectSuccess) {
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
		console.log(result.stdout.trim());
	} else {
		assert.notEqual(result.status, 0, 'Broken native dependencies must fail validation');
	}
}

try {
	await fs.mkdir(sidecar, { recursive: true });
	await fs.cp(path.join(root, 'resources/python'), path.dirname(python), { recursive: true });
	await fs.cp(path.join(root, 'build/python'), path.join(relocated, 'build/python'), { recursive: true });
	for (const name of ['requirements.txt', 'check_deps.py', 'VERSION']) {
		await fs.copyFile(path.join(root, 'resources/uwa-sidecar', name), path.join(sidecar, name));
	}
	await fs.cp(path.join(root, 'resources/uwa-sidecar/app'), path.join(sidecar, 'app'), {
		recursive: true, filter: source => !source.split(path.sep).includes('__pycache__')
	});
	run([path.join(relocated, 'build/python/verify-runtime.py'), relocated]);
	run(['-m', 'pip', '--disable-pip-version-check', 'check']);
	run(['-c', `
import asyncio, json, sys
from fastapi import FastAPI
from pydantic import BaseModel
class Health(BaseModel):
    alive: bool
app = FastAPI()
@app.get('/health', response_model=Health)
async def health():
    return {'alive': True}
messages = []
async def receive():
    return {'type': 'http.request', 'body': b'', 'more_body': False}
async def send(message):
    messages.append(message)
scope = {'type': 'http', 'asgi': {'version': '3.0'}, 'method': 'GET', 'path': '/health',
         'raw_path': b'/health', 'query_string': b'', 'headers': [], 'http_version': '1.1',
         'scheme': 'http', 'server': ('127.0.0.1', 8199), 'client': ('127.0.0.1', 12345), 'root_path': ''}
asyncio.run(app(scope, receive, send))
assert messages[0]['status'] == 200, messages
body = b''.join(m.get('body', b'') for m in messages)
assert json.loads(body) == {'alive': True}, body
assert sys.flags.utf8_mode == 1
print('PASS: relocated FastAPI/Pydantic request with empty PATH and poisoned PYTHON environment')
`]);
	// Simulate a missing native DLL/module in the disposable copy, never in the real runtime.
	await fs.rename(path.join(path.dirname(python), 'Lib/site-packages/win32/win32api.pyd'),
		path.join(path.dirname(python), 'Lib/site-packages/win32/win32api.pyd.disabled'));
	run([path.join(sidecar, 'check_deps.py')], false);
	console.log('PASS: missing pywin32 native module detected');
} finally {
	await fs.rm(temporary, { recursive: true, force: true });
}
