/*---------------------------------------------------------------------------------------------
 *  受控浏览器启动器
 *
 *  uwa 不会自己拉起浏览器 —— 它用 DrissionPage 的「接管」模式，去连接
 *  127.0.0.1:<port> 上一个已开启远程调试端口的 Chrome。连不上时 uwa 只记
 *  一条 WRN 就继续启动（service ready 照常打印），因此这个失败极易被忽略：
 *  服务看起来是好的，但所有网页操作都无法进行。
 *
 *  这里负责在 spawn Python 之前把那个 Chrome 准备好。
 *--------------------------------------------------------------------------------------------*/
import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';

export interface BrowserOptions {
	/** 远程调试端口，须与 uwa 的 BROWSER_PORT 一致 */
	port: number;
	/** 用户资料目录；独立目录可避免污染用户日常 Chrome，也防止 profile 争用 */
	profileDir: string;
	/** 显式指定可执行文件；留空则自动探测 */
	executablePath?: string;
	log: (msg: string) => void;
}

const WINDOWS_CANDIDATES = [
	'%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe',
	'%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe',
	'%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe',
	'%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe',
	'%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe',
];

const DARWIN_CANDIDATES = [
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

const LINUX_CANDIDATES = [
	'/usr/bin/google-chrome',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/usr/bin/microsoft-edge',
];

function expand(p: string): string {
	return p.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '');
}

export function detectBrowser(explicit?: string): string | undefined {
	if (explicit) {
		return fs.existsSync(explicit) ? explicit : undefined;
	}
	const list = process.platform === 'win32'
		? WINDOWS_CANDIDATES
		: process.platform === 'darwin' ? DARWIN_CANDIDATES : LINUX_CANDIDATES;
	for (const cand of list) {
		const full = expand(cand);
		if (full && fs.existsSync(full)) {
			return full;
		}
	}
	return undefined;
}

/**
 * 探测调试端口是否已就绪。
 *
 * 用 /json/version 而不是裸 TCP 连接：端口被占用不代表对端是一个可接管的
 * Chrome，必须确认它真的在说 DevTools 协议。
 */
export function probeDevTools(port: number, timeoutMs = 1500): Promise<string | undefined> {
	return new Promise(resolve => {
		const req = http.get(
			{ host: '127.0.0.1', port, path: '/json/version', timeout: timeoutMs },
			res => {
				let body = '';
				res.on('data', c => (body += c));
				res.on('end', () => {
					try {
						resolve(JSON.parse(body).Browser ?? 'unknown');
					} catch {
						resolve(undefined);
					}
				});
			},
		);
		req.on('error', () => resolve(undefined));
		req.on('timeout', () => { req.destroy(); resolve(undefined); });
	});
}

export class BrowserLauncher {
	private proc: ChildProcess | undefined;
	/** 复用既有实例时为 false —— 不是我们起的，就不该由我们杀掉 */
	private owned = false;

	constructor(private readonly opts: BrowserOptions) { }

	/** 确保调试端口上有一个可接管的浏览器；返回其版本串 */
	async ensure(): Promise<string | undefined> {
		const existing = await probeDevTools(this.opts.port);
		if (existing) {
			this.opts.log(`reusing browser on :${this.opts.port} (${existing})`);
			return existing;
		}

		const exe = detectBrowser(this.opts.executablePath);
		if (!exe) {
			this.opts.log('no Chrome/Edge found; set incontrol.sidecar.browserPath');
			return undefined;
		}

		fs.mkdirSync(this.opts.profileDir, { recursive: true });
		this.opts.log(`launching ${path.basename(exe)} :${this.opts.port}`);

		this.proc = spawn(exe, [
			`--remote-debugging-port=${this.opts.port}`,
			`--user-data-dir=${this.opts.profileDir}`,
			'--no-first-run',
			'--no-default-browser-check',
			'--disable-popup-blocking',
			// 后台标签页会被降频，导致 uwa 轮询回复时误判为「静默超时」
			'--disable-background-timer-throttling',
			'--disable-backgrounding-occluded-windows',
			'--disable-renderer-backgrounding',
		], { detached: process.platform !== 'win32', stdio: 'ignore' });

		this.proc.on('exit', code => {
			this.opts.log(`browser exited code=${code}`);
			this.proc = undefined;
		});
		this.owned = true;

		// Chrome 冷启动到 DevTools 可用有明显延迟，轮询而非固定 sleep
		const deadline = Date.now() + 20000;
		while (Date.now() < deadline) {
			const v = await probeDevTools(this.opts.port);
			if (v) {
				this.opts.log(`browser ready: ${v}`);
				return v;
			}
			await new Promise(r => setTimeout(r, 500));
		}
		this.opts.log('browser did not expose DevTools within 20s');
		return undefined;
	}

	/** 只关闭我们自己启动的实例 */
	async dispose(): Promise<void> {
		if (!this.proc || !this.owned) {
			return;
		}
		const pid = this.proc.pid;
		this.proc = undefined;
		if (!pid) {
			return;
		}
		try {
			if (process.platform === 'win32') {
				// Chrome 是多进程的，必须带 /T 收掉整棵树
				spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
			} else {
				process.kill(-pid, 'SIGTERM');
			}
		} catch { /* 已退出 */ }
	}
}
