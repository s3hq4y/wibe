/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const target = path.join(root, 'resources/python');
const cache = path.join(root, '.build/wibe-python/downloads');
const lockPath = path.join(here, 'dependencies-win32-x64.lock.json');
const requirementPath = path.join(root, 'resources/uwa-sidecar/requirements.txt');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const normalized = value => value.replace(/\r\n/g, '\n');

function environment() {
	const env = { ...process.env };
	for (const key of Object.keys(env)) {
		if (/^(PYTHON|PIP_)/i.test(key)) { delete env[key]; }
	}
	env.PIP_CONFIG_FILE = process.platform === 'win32' ? 'NUL' : '/dev/null';
	return env;
}

function run(exe, args, cwd = root, env = environment()) {
	return new Promise((resolve, reject) => {
		const child = spawn(exe, args, { cwd, env, stdio: 'inherit', windowsHide: true, timeout: 900_000 });
		child.once('error', reject);
		child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(exe)} exited with ${code}`)));
	});
}

async function download(artifact) {
	const url = new URL(artifact.url);
	if (url.protocol !== 'https:' || !['www.python.org', 'files.pythonhosted.org'].includes(url.hostname)) {
		throw new Error(`Unapproved artifact URL: ${url}`);
	}
	if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) { throw new Error('Invalid artifact SHA256'); }
	const file = path.join(cache, `${artifact.sha256}-${path.basename(url.pathname)}`);
	await fs.mkdir(cache, { recursive: true });
	try {
		if (sha256(await fs.readFile(file)) === artifact.sha256) { return file; }
	} catch (error) {
		if (error.code !== 'ENOENT') { throw error; }
	}
	console.log(`Downloading ${path.basename(url.pathname)}`);
	// Bounded range requests also tolerate slow per-connection links on build machines.
	// A range response is never trusted as an artifact hash: verify the assembled full SHA256 below.
	const chunkBytes = 512 * 1024;
	const first = await fetch(url, { headers: { Range: `bytes=0-${chunkBytes - 1}` },
		signal: AbortSignal.timeout(600_000), redirect: 'error' });
	if (!first.ok) { throw new Error(`Download failed: HTTP ${first.status} (${url})`); }
	let bytes;
	if (first.status === 200) {
		bytes = Buffer.from(await first.arrayBuffer());
	} else {
		const match = /^bytes 0-(?<end>\d+)\/(?<total>\d+)$/.exec(first.headers.get('content-range') ?? '');
		if (first.status !== 206 || !match) { throw new Error(`Invalid range response: ${url}`); }
		const total = Number(match.groups.total);
		if (!Number.isSafeInteger(total) || total < 1 || total > 128 * 1024 * 1024) { throw new Error('Invalid artifact size'); }
		const chunks = new Array(Math.ceil(total / chunkBytes));
		chunks[0] = Buffer.from(await first.arrayBuffer());
		if (chunks[0].length !== Math.min(chunkBytes, total)) { throw new Error('Incomplete first artifact range'); }
		let next = 1;
		const workers = await Promise.allSettled(Array.from({ length: Math.min(4, chunks.length - 1) }, async () => {
			while (next < chunks.length) {
				const index = next++;
				const start = index * chunkBytes;
				const end = Math.min(total - 1, start + chunkBytes - 1);
				const response = await fetch(url, { headers: { Range: `bytes=${start}-${end}` },
					signal: AbortSignal.timeout(600_000), redirect: 'error' });
				if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${total}`) {
					await response.body?.cancel();
					throw new Error(`Invalid artifact range: ${url}`);
				}
				chunks[index] = Buffer.from(await response.arrayBuffer());
				if (chunks[index].length !== end - start + 1) { throw new Error('Incomplete artifact range'); }
			}
		}));
		for (const worker of workers) {
			if (worker.status === 'rejected') { throw worker.reason; }
		}
		bytes = Buffer.concat(chunks);
	}
	if (sha256(bytes) !== artifact.sha256) { throw new Error(`SHA256 mismatch: ${url}`); }
	const temporary = `${file}.${randomUUID()}.tmp`;
	await fs.writeFile(temporary, bytes);
	await fs.rename(temporary, file);
	return file;
}

async function validate(python) {
	await run(python, ['-I', '-B', '-X', 'utf8', path.join(here, 'verify-runtime.py'), root]);
}

async function prepare(updateLock) {
	if (process.platform !== 'win32' || process.arch !== 'x64') {
		throw new Error('The bundled runtime must be prepared on Windows x64. Other targets are not supported yet.');
	}
	const pins = JSON.parse(await fs.readFile(path.join(here, 'runtime.json'), 'utf8'));
	const requirementsSha256 = sha256(normalized(await fs.readFile(requirementPath, 'utf8')));
	let lock;
	if (updateLock) {
		try {
			await fs.access(lockPath);
			throw new Error('Dependency lock already exists. Move it to a review backup before explicitly regenerating it.');
		} catch (error) {
			if (error.code !== 'ENOENT') { throw error; }
		}
	}
	if (!updateLock) {
		lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
		if (lock.platform !== 'win32-x64' || lock.requirementsSha256 !== requirementsSha256 || lock.python !== pins.python.version) {
			throw new Error('Python dependency lock is stale. Review requirements, then run with --update-lock.');
		}
	}
	const fingerprint = lock && sha256(JSON.stringify({ pins, lock,
		builder: normalized(await fs.readFile(fileURLToPath(import.meta.url), 'utf8')),
		verifier: normalized(await fs.readFile(path.join(here, 'verify-runtime.py'), 'utf8')),
		checker: normalized(await fs.readFile(path.join(root, 'resources/uwa-sidecar/check_deps.py'), 'utf8'))
	}));
	let existing;
	try { existing = JSON.parse(await fs.readFile(path.join(target, 'wibe-runtime.json'), 'utf8')); }
	catch (error) {
		if (error.code !== 'ENOENT') { throw error; }
		try { await fs.access(target); throw new Error('Refusing to replace unmanaged resources/python'); }
		catch (accessError) { if (accessError.code !== 'ENOENT') { throw accessError; } }
	}
	if (existing && existing.platform !== 'win32-x64') { throw new Error('Refusing to replace an unrecognized runtime'); }
	if (existing && existing.fingerprint === fingerprint && !updateLock) {
		try {
			await validate(path.join(target, 'python.exe'));
			console.log('Bundled Python is current and verified.');
			return;
		} catch {
			console.log('Existing runtime failed validation; rebuilding from verified artifacts.');
		}
	}

	// A unique sibling staging directory preserves the same relative sidecar import path.
	const stage = path.join(root, `resources/.python-stage-${randomUUID()}`);
	await fs.mkdir(stage, { recursive: true });
	try {
		const archive = await download(pins.python);
		await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
			'Expand-Archive -LiteralPath $env:WIBE_PYTHON_ZIP -DestinationPath $env:WIBE_PYTHON_STAGE'], root,
			{ ...environment(), WIBE_PYTHON_ZIP: archive, WIBE_PYTHON_STAGE: stage });
		const tag = pins.python.version.split('.').slice(0, 2).join('');
		await fs.writeFile(path.join(stage, `python${tag}._pth`),
			`python${tag}.zip\n.\nLib/site-packages\n../uwa-sidecar\nimport site\n`);
		const python = path.join(stage, 'python.exe');
		const pipWheel = await download(pins.pip);
		await run(python, ['-I', '-B', '-c', 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
			pipWheel, path.join(stage, 'Lib/site-packages')]);
		const pip = ['-I', '-B', '-X', 'utf8', '-m', 'pip', '--disable-pip-version-check', '--no-cache-dir'];
		if (updateLock) {
			const report = path.join(stage, 'resolve-report.json');
			await run(python, [...pip, 'install', '--dry-run', '--ignore-installed', '--only-binary=:all:',
				'--index-url', 'https://pypi.org/simple', '--report', report, '-r', requirementPath]);
			const resolved = JSON.parse(await fs.readFile(report, 'utf8'));
			lock = { platform: 'win32-x64', python: pins.python.version, requirementsSha256,
				packages: resolved.install.map(item => ({ name: item.metadata.name, version: item.metadata.version,
					url: item.download_info.url, sha256: item.download_info.archive_info.hashes.sha256
				})).sort((a, b) => a.name.localeCompare(b.name)) };
			// Refuse to silently rewrite a committed lock; regeneration is an explicit maintainer action.
			await fs.writeFile(lockPath, JSON.stringify(lock, null, '\t') + '\n', { flag: 'wx' });
			console.log('Dependency lock created. Run again without --update-lock to build the runtime.');
			return;
		}
		const wheels = path.join(stage, '_wheels');
		await fs.mkdir(wheels);
		// Keep memory/connections bounded while avoiding serial network latency for every wheel.
		for (let offset = 0; offset < lock.packages.length; offset += 4) {
			const results = await Promise.allSettled(lock.packages.slice(offset, offset + 4).map(async item => {
				const downloaded = await download(item);
				await fs.copyFile(downloaded, path.join(wheels, path.basename(new URL(item.url).pathname)));
			}));
			for (const result of results) {
				if (result.status === 'rejected') { throw result.reason; }
			}
		}
		const installLock = path.join(stage, '_requirements.lock');
		await fs.writeFile(installLock, lock.packages.map(item => `${item.name}==${item.version} --hash=sha256:${item.sha256}`).join('\n') + '\n');
		await run(python, [...pip, 'install', '--no-index', '--find-links', wheels, '--only-binary=:all:',
			'--require-hashes', '--no-compile', '--no-warn-script-location', '-r', installLock]);
		await run(python, [...pip, 'check']);
		await validate(python);
		// pip-generated console launchers embed the staging path. Use python -m instead.
		await fs.rm(path.join(stage, 'Scripts'), { recursive: true, force: true });
		await fs.rm(wheels, { recursive: true });
		await fs.rm(installLock);
		await fs.writeFile(path.join(stage, 'wibe-runtime.json'), JSON.stringify({
			platform: 'win32-x64', python: pins.python.version, fingerprint, requirementsSha256
		}, null, '\t') + '\n');
		// Only a previously managed runtime may be replaced, and only after the new one passes validation.
		const backup = `${target}.previous-${randomUUID()}`;
		if (existing) { await fs.rename(target, backup); }
		try { await fs.rename(stage, target); }
		catch (error) {
			if (existing) { await fs.rename(backup, target); }
			throw error;
		}
		if (existing) { await fs.rm(backup, { recursive: true }); }
		console.log(`Bundled Python ready: ${target}`);
	} finally {
		await fs.rm(stage, { recursive: true, force: true });
	}
}

// Exclude concurrent builds from publishing competing runtime/lock versions.
await fs.mkdir(path.join(root, '.build/wibe-python'), { recursive: true });
const mutexPath = path.join(root, '.build/wibe-python/prepare.lock');
const mutex = await fs.open(mutexPath, 'wx');
await mutex.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
try { await prepare(process.argv.includes('--update-lock')); }
finally { await mutex.close(); await fs.rm(mutexPath); }
