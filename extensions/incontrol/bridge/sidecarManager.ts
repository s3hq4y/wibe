/*---------------------------------------------------------------------------------------------
 *  uwa-sidecar 生命周期托管
 *
 *  职责：spawn Python 服务、健康检查、级联优雅关闭。
 *
 *  为什么级联关闭很重要：uwa 会自行拉起一个真实 Chrome 进程。若只杀 Python
 *  而不管 Chrome，用户机器上会不断堆积孤儿 Chrome 实例，并且下次启动时
 *  chrome_profile 会被占用导致启动失败。
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, spawn } from 'child_process';
import { BrowserLauncher } from './browserLauncher';
import * as net from 'net';
import * as path from 'path';
import { DEFAULT_SIDECAR_PORT, SidecarHealth } from './protocol';

export interface SidecarOptions {
	/** resources/uwa-sidecar 的绝对路径 */
	sidecarRoot: string;
	/** Python 解释器路径；未提供时按平台探测 */
	pythonPath?: string;
	browserPath?: string;
	browserPort?: number;
	preferredPort?: number;
	/** 日志回调，接到扩展的 OutputChannel */
	log?: (line: string) => void;
}

export class SidecarManager {
	private proc: ChildProcess | undefined;
	private browser: BrowserLauncher | undefined;
	private port: number = DEFAULT_SIDECAR_PORT;
	private healthTimer: NodeJS.Timeout | undefined;
	private disposed = false;

	constructor(private readonly opts: SidecarOptions) { }

	private log(msg: string): void {
		this.opts.log?.(`[uwa-sidecar] ${msg}`);
	}

	/** 探测端口是否已被占用 */
	private static probePort(port: number): Promise<boolean> {
		return new Promise(resolve => {
			const sock = new net.Socket();
			const done = (inUse: boolean) => {
				sock.destroy();
				resolve(inUse);
			};
			sock.setTimeout(600);
			sock.once('connect', () => done(true));
			sock.once('timeout', () => done(false));
			sock.once('error', () => done(false));
			sock.connect(port, '127.0.0.1');
		});
	}

	/** 从 preferred 起向后找一个空闲端口 */
	private async pickPort(preferred: number): Promise<number> {
		for (let p = preferred; p < preferred + 20; p++) {
			if (!(await SidecarManager.probePort(p))) {
				return p;
			}
		}
		throw new Error(`no free port in [${preferred}, ${preferred + 20})`);
	}

	/**
	 * 启动 sidecar。
	 *
	 * 若目标端口上已有健康实例（用户手动起的、或上次未清理干净的），
	 * 直接复用而不重复 spawn —— 避免两个实例抢同一个 chrome_profile。
	 */
	/**
	 * 选解释器：sidecar 自带的 venv 优先（start.py 若跑过会生成），
	 * 否则回退到系统 Python 探测。
	 */
	private resolvePython(): string {
		const venvPy = process.platform === 'win32'
			? path.join(this.opts.sidecarRoot, 'venv', 'Scripts', 'python.exe')
			: path.join(this.opts.sidecarRoot, 'venv', 'bin', 'python');
		try {
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			if (require('fs').existsSync(venvPy)) {
				return venvPy;
			}
		} catch { /* ignore */ }
		return this.detectPython();
	}

	async start(): Promise<SidecarHealth> {
		const preferred = this.opts.preferredPort ?? DEFAULT_SIDECAR_PORT;

		if (await SidecarManager.probePort(preferred)) {
			const health = await this.checkHealth(preferred);
			if (health.alive) {
				this.port = preferred;
				this.log(`reusing existing instance on :${preferred}`);
				this.startHealthLoop();
				return health;
			}
			this.log(`port ${preferred} occupied by non-uwa process, picking another`);
		}

		this.port = await this.pickPort(preferred);

		// start.py 是 venv 引导脚本：它会新建 venv/、联网装依赖、必要时下载
		// Python 本体，耗时以分钟计，远超我们 15s 的探活窗口，且装出来的解释器
		// 与我们探测到的不是同一个。main.py 才是真正的 uvicorn 服务入口。
		// uwa 只「接管」浏览器、不负责启动它；连不上时它仅记一条 WRN 就继续跑，
		// 所以必须在这里先把调试端口上的浏览器准备好，否则服务看似正常但完全不可用。
		const browserPort = this.opts.browserPort ?? 9222;
		this.browser = new BrowserLauncher({
			port: browserPort,
			profileDir: path.join(this.opts.sidecarRoot, 'chrome_profile'),
			executablePath: this.opts.browserPath,
			log: m => this.log(`[browser] ${m}`),
		});
		await this.browser.ensure();

		const entry = path.join(this.opts.sidecarRoot, 'main.py');
		const python = this.opts.pythonPath || this.resolvePython();

		this.log(`spawning: ${python} ${entry} (port ${this.port})`);
		this.proc = spawn(python, [entry], {
			cwd: this.opts.sidecarRoot,
			env: {
				...process.env,
				APP_PORT: String(this.port),
				BROWSER_PORT: String(browserPort),
				// ide 模式是本项目为 IDE 场景新增的历史模式
				HISTORY_MODE: 'ide',
				PYTHONIOENCODING: 'utf-8',
				PYTHONUNBUFFERED: '1',
			},
			// Windows 下建独立进程组，便于连同子进程（Chrome）一起结束
			detached: process.platform !== 'win32',
			stdio: ['ignore', 'pipe', 'pipe'],
		});

		this.proc.stdout?.on('data', d => this.log(String(d).trimEnd()));
		this.proc.stderr?.on('data', d => this.log(String(d).trimEnd()));
		this.proc.on('exit', (code, signal) => {
			this.log(`exited code=${code} signal=${signal}`);
			this.proc = undefined;
		});

		const ok = await this.waitReady(60_000);
		if (!ok) {
			await this.stop();
			return { alive: false, port: this.port, error: 'startup timeout (60s)' };
		}

		this.startHealthLoop();
		return this.checkHealth(this.port);
	}

	private detectPython(): string {
		// 优先使用随产品分发的 embeddable Python
		const bundled = path.join(this.opts.sidecarRoot, '..', 'python', 'python.exe');
		if (process.platform === 'win32') {
			return bundled;
		}
		return 'python3';
	}

	private async waitReady(timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (this.disposed) {
				return false;
			}
			const h = await this.checkHealth(this.port);
			if (h.alive) {
				return true;
			}
			await new Promise(r => setTimeout(r, 1000));
		}
		return false;
	}

	async checkHealth(port = this.port): Promise<SidecarHealth> {
		try {
			const ctl = new AbortController();
			const t = setTimeout(() => ctl.abort(), 3000);
			const res = await fetch(`http://127.0.0.1:${port}/api/pool/status`, {
				signal: ctl.signal,
			});
			clearTimeout(t);
			if (!res.ok) {
				return { alive: false, port, error: `HTTP ${res.status}` };
			}
			const body: any = await res.json().catch(() => ({}));
			return {
				alive: true,
				port,
				pid: this.proc?.pid,
				browserReady: Boolean(body?.browser_ready ?? body?.tabs?.length),
			};
		} catch (e: any) {
			return { alive: false, port, error: String(e?.message ?? e) };
		}
	}

	/** 周期探活；挂了自动重启一次 */
	private startHealthLoop(): void {
		this.stopHealthLoop();
		this.healthTimer = setInterval(async () => {
			if (this.disposed) {
				return;
			}
			const h = await this.checkHealth();
			if (!h.alive && this.proc === undefined) {
				this.log('health check failed and process gone; restarting');
				await this.start().catch(e => this.log(`restart failed: ${e}`));
			}
		}, 15_000);
	}

	private stopHealthLoop(): void {
		if (this.healthTimer) {
			clearInterval(this.healthTimer);
			this.healthTimer = undefined;
		}
	}

	getPort(): number {
		return this.port;
	}

	getBaseUrl(): string {
		return `http://127.0.0.1:${this.port}`;
	}

	/**
	 * 优雅关闭：先请求 uwa 自行收尾（它会关掉自己拉起的 Chrome），
	 * 超时后再强杀整个进程树。
	 */
	async stop(): Promise<void> {
		await this.browser?.dispose();
		this.browser = undefined;
		this.disposed = true;
		this.stopHealthLoop();

		if (!this.proc) {
			return;
		}
		const pid = this.proc.pid;

		try {
			const ctl = new AbortController();
			setTimeout(() => ctl.abort(), 3000);
			await fetch(`${this.getBaseUrl()}/api/shutdown`, {
				method: 'POST',
				signal: ctl.signal,
			});
			this.log('graceful shutdown requested');
		} catch {
			// 端点不存在或已死，走强杀
		}

		const exited = await Promise.race([
			new Promise<boolean>(r => this.proc?.once('exit', () => r(true))),
			new Promise<boolean>(r => setTimeout(() => r(false), 5000)),
		]);

		if (!exited && pid !== undefined) {
			this.log(`force killing process tree pid=${pid}`);
			try {
				if (process.platform === 'win32') {
					// /T 连同子进程（Chrome）一并结束
					spawn('taskkill', ['/pid', String(pid), '/T', '/F']);
				} else {
					process.kill(-pid, 'SIGKILL');
				}
			} catch (e) {
				this.log(`kill failed: ${e}`);
			}
		}
		this.proc = undefined;
	}
}
