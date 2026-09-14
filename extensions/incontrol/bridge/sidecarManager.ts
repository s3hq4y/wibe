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
import * as fs from 'fs';
import { BrowserLauncher } from './browserLauncher';
import * as net from 'net';
import * as path from 'path';
import { DEFAULT_SIDECAR_PORT, SidecarHealth } from './protocol';

/** sidecar 最低要求的 Python 版本（与 resources/uwa-sidecar/requirements.txt 的 >=3.10 对应） */
const MIN_PYTHON = '3.10';

/** 由 MIN_PYTHON 派生的元组字面量（'3.10' → '(3, 10)'），供探针脚本内联 */
const MIN_PYTHON_TUPLE = `(${MIN_PYTHON.split('.').join(', ')})`;

/** 候选 Python 的主版本号，由高到低 */
const WINDOWS_PYTHON_MINORS = [14, 13, 12, 11, 10];

/** 解释器探测结果 */
interface InterpreterProbe {
	ok: boolean;
	/** 失败原因（ok=false 时有值），用于日志与最终提示 */
	reason?: string;
}


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
	 * 跑一次子进程并收集输出。
	 *
	 * 探测失败是预期路径而非异常，所以这里永不 reject —— 调用方只看返回值。
	 */
	private static run(
		exe: string,
		args: string[],
		cwd: string,
		timeoutMs: number,
		env: NodeJS.ProcessEnv = process.env,
	): Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: string }> {
		return new Promise(resolve => {
			let settled = false;
			let timer: NodeJS.Timeout | undefined;
			const finish = (r: { code: number | null; stdout: string; stderr: string; spawnError?: string }) => {
				if (settled) { return; }
				settled = true;
				if (timer) { clearTimeout(timer); }
				resolve(r);
			};

			const child = spawn(exe, args, {
				cwd,
				env,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'pipe'],
			});
			let stdout = '';
			let stderr = '';
			child.stdout?.on('data', d => { stdout += String(d); });
			child.stderr?.on('data', d => { stderr += String(d); });
			child.on('error', err => {
				const e = err as NodeJS.ErrnoException;
				finish({ code: null, stdout, stderr, spawnError: e.code ?? e.message });
			});
			child.on('close', code => finish({ code, stdout, stderr }));

			timer = setTimeout(() => {
				try { child.kill(); } catch { /* ignore */ }
				finish({ code: null, stdout, stderr, spawnError: 'timeout' });
			}, timeoutMs);
		});
	}

	/**
	 * venv 引导器的经典报错：pyvenv.cfg 里的 home 指向一台不存在的基础解释器
	 * （典型场景：venv 是在别的机器上创建的）。
	 */
	private static isForeignVenv(stderr: string): boolean {
		return /No Python at\s/i.test(stderr || '');
	}

	/** Bundled Python is relocatable and must never inherit a system/Conda Python environment. */
	private bundledPython(): string {
		return path.resolve(this.opts.sidecarRoot, '..', 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
	}

	private isBundledPython(executable: string): boolean {
		const resolved = path.resolve(executable);
		const bundled = this.bundledPython();
		return process.platform === 'win32' ? resolved.toLowerCase() === bundled.toLowerCase() : resolved === bundled;
	}

	private pythonEnvironment(executable: string): NodeJS.ProcessEnv {
		const env = { ...process.env };
		if (this.isBundledPython(executable)) {
			for (const key of Object.keys(env)) {
				if (/^PYTHON/i.test(key)) { delete env[key]; }
			}
		}
		return env;
	}

	private pythonArguments(executable: string, args: string[]): string[] {
		// -I ignores PYTHONHOME/PYTHONPATH/user site; -B permits read-only installation directories.
		// Encoding and unbuffered output use flags because isolated mode ignores PYTHON* variables.
		return this.isBundledPython(executable) ? ['-I', '-B', '-X', 'utf8', '-u', ...args] : args;
	}

	/**
	 * 探测解释器是否**真的可用**。
	 *
	 * 只判断文件存在是不够的：曾出现发行包里带着一台开发机的 venv，它的
	 * pyvenv.cfg 指向的基础解释器在用户机器上并不存在，引导器直接退码 103；
	 * 而它因为"文件存在"被优先选中，随后回落到 PATH 上的 Python 3.8（缺依赖），
	 * 报错发生在 20 秒之后的 import 阶段 —— 用户最终只看到 60 秒启动超时。
	 * 把判据从"存在"换成"能跑且依赖齐全"，问题就会在选择阶段立刻暴露。
	 */
	private async probeInterpreter(pythonPath: string): Promise<InterpreterProbe> {
		// 1) 版本门槛：低于要求的版本直接排除
		const ver = await SidecarManager.run(
			pythonPath,
			this.pythonArguments(pythonPath, ['-c', `import sys; raise SystemExit(0 if sys.version_info >= ${MIN_PYTHON_TUPLE} else 1)`]),
			this.opts.sidecarRoot,
			10_000,
			this.pythonEnvironment(pythonPath),
		);
		if (ver.spawnError) {
			return { ok: false, reason: `无法执行（${ver.spawnError}）` };
		}
		if (SidecarManager.isForeignVenv(ver.stderr)) {
			return {
				ok: false,
				reason: 'pyvenv.cfg 指向的基础解释器不存在（该 venv 多半是在别的机器上创建的），建议删除 venv 后重新运行 start.py',
			};
		}
		if (ver.code !== 0) {
			return { ok: false, reason: `不满足 Python >= ${MIN_PYTHON}` };
		}

		// 2) 依赖完整性：复用 sidecar 自带的 check_deps.py，
		//    避免在 TS 里再维护一份依赖清单 —— requirements.txt 是唯一事实来源
		const checkScript = path.join(this.opts.sidecarRoot, 'check_deps.py');
		if (!fs.existsSync(checkScript)) {
			if (this.isBundledPython(pythonPath)) { return { ok: false, reason: '安装包缺少 check_deps.py，请重新安装完整的 Wibe 安装包' }; }
			// 旧版开发环境保留兼容；发行包必须包含依赖检测脚本
			this.log(`python: 未找到 ${checkScript}，跳过依赖完整性检查`);
			return { ok: true };
		}
		const deps = await SidecarManager.run(pythonPath, this.pythonArguments(pythonPath, [checkScript]), this.opts.sidecarRoot, 30_000, this.pythonEnvironment(pythonPath));
		if (deps.spawnError || deps.code !== 0) {
			const detail = (deps.stdout || deps.stderr || '').trim().split('\n').pop() ?? '';
			return { ok: false, reason: detail ? `依赖不完整（${detail}）` : '依赖不完整' };
		}
		return { ok: true };
	}

	/**
	 * 系统环境变量里声明的解释器 —— 未提供内置运行时的开发环境回退来源。
	 *
	 * 仅当未随产品分发内置运行时时才探测系统环境变量。
	 *
	 * 覆盖：
	 *   PYTHON / PYTHON_EXE  显式指定解释器（可指到 exe，也可指到安装根目录）
	 *   PYTHONHOME           解释器所在目录
	 *   PATH                 逐目录展开，而不是只把 'python.exe' 交给 spawn ——
	 *                        spawn 只能命中第一条，且无法跳过其中坏掉的那个
	 *
	 * 只做存在性过滤（PATH 动辄几十条，逐条 spawn 探测太慢）；是否真正可用仍交给
	 * probeInterpreter 判断，依赖不全的解释器会在那里被跳过并记下原因。
	 */
	private listEnvCandidates(): string[] {
		const win = process.platform === 'win32';
		const exe = win ? 'python.exe' : 'python';
		const list: string[] = [];

		const unquote = (p: string) => p.trim().replace(/^"(.*)"$/, '$1');

		/** 目录则拼上 exe，其余原样返回（兼容 PATH 里直接写命令名的情形） */
		const asExe = (p: string): string => {
			try {
				if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
					return path.join(p, exe);
				}
			} catch {
				// 无权限等情况按普通路径处理
			}
			return p;
		};

		const push = (raw: string | undefined): void => {
			if (!raw) { return; }
			const cleaned = unquote(raw);
			if (!cleaned) { return; }
			// 绝对路径要求真实存在；非绝对路径（配置里写的命令名）保留给 spawn 解析
			if (path.isAbsolute(cleaned) && !fs.existsSync(cleaned)) { return; }
			list.push(cleaned);
		};

		for (const key of ['PYTHON', 'PYTHON_EXE']) {
			const v = process.env[key];
			if (v) { push(asExe(unquote(v))); }
		}
		if (process.env.PYTHONHOME) {
			push(path.join(unquote(process.env.PYTHONHOME), exe));
		}
		for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
			if (dir) { push(path.join(dir, exe)); }
		}

		return list;
	}

	/**
	 * Windows 常见安装位置（PATH 未配置 Python 时的补充）。
	 *
	 * 布局与 start.py:_find_installed_fixed_python 对齐。旧实现漏掉了
	 * %LOCALAPPDATA%\Programs\Python\Python3XX —— 而这正是 python.org
	 * "仅为当前用户"安装的落地位置，本机 Python 3.11 就是这样被跳过的。
	 */
	private listInstalledCandidates(): string[] {
		if (process.platform !== 'win32') { return []; }
		const exe = 'python.exe';
		const list: string[] = [];
		const roots = [process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']];
		for (const minor of WINDOWS_PYTHON_MINORS) {
			const tag = `Python3${minor}`;
			for (const root of roots) {
				if (!root) { continue; }
				list.push(path.join(root, 'Programs', 'Python', tag, exe));
				list.push(path.join(root, tag, exe));
			}
		}
		return list;
	}

	/**
	 * 随 sidecar 生成的开发环境解释器 —— 兜底，排最后。
	 *
	 * sidecar 自建 venv 尤其不能排在前面：发行包里混进过开发机的 venv
	 * （pyvenv.cfg 指向不存在的基础解释器，引导器直接退码 103），而它因为
	 * "文件存在"被优先选中，把问题一路拖到 60 秒启动超时。
	 */
	private listPackagedCandidates(): string[] {
		const win = process.platform === 'win32';
		const exe = win ? 'python.exe' : 'python';
		return [
			// sidecar 自建 venv（start.py 跑过之后会有）
			path.join(this.opts.sidecarRoot, 'venv', win ? 'Scripts' : 'bin', exe),
		];
	}

	/**
	 * 通过 py 启动器解析真实解释器路径。
	 *
	 * py 能覆盖注册表里登记过的任意安装位置（包括非默认目录），比穷举路径可靠；
	 * start.py 也是这么做的。
	 */
	private async resolveViaPyLauncher(): Promise<string[]> {
		if (process.platform !== 'win32') { return []; }
		const found: string[] = [];
		for (const minor of WINDOWS_PYTHON_MINORS) {
			const r = await SidecarManager.run(
				'py', [`-3.${minor}`, '-c', 'import sys; print(sys.executable)'],
				this.opts.sidecarRoot, 10_000,
			);
			const resolved = r.stdout.trim();
			if (r.code === 0 && resolved) {
				found.push(resolved);
			}
		}
		return found;
	}

	/**
	 * Explicit override -> bundled runtime -> system Python -> local development venv.
	 * A present but damaged bundle fails closed instead of silently selecting an unrelated Python.
	 */
	private async resolvePython(): Promise<string | undefined> {
		const seen = new Set<string>();
		const failures: string[] = [];

		const firstViable = async (candidates: string[]): Promise<string | undefined> => {
			for (const c of candidates) {
				if (!c || seen.has(c)) { continue; }
				seen.add(c);
				const probe = await this.probeInterpreter(c);
				if (probe.ok) {
					this.log(`python: ${c}`);
					return c;
				}
				// 路径压根不存在的候选不记日志，避免刷屏；只报"存在但不可用"的
				if (probe.reason && !probe.reason.startsWith('无法执行')) {
					this.log(`python: 跳过 ${c} —— ${probe.reason}`);
					failures.push(`${c} → ${probe.reason}`);
				}
			}
			return undefined;
		};

		const explicit = this.opts.pythonPath;
		if (explicit) {
			const hit = await firstViable([explicit]);
			if (hit) { return hit; }
		}

		const bundled = this.bundledPython();
		if (fs.existsSync(path.dirname(bundled))) {
			const hit = await firstViable([bundled]);
			if (hit) { return hit; }
			this.log('内置 Python 运行时损坏或依赖不完整，请重新安装完整的 Wibe 安装包；不会回退到系统 Python。');
			return undefined;
		}

		// Compatibility for source checkouts and platforms without a bundled runtime.
		const viaEnv = await firstViable(this.listEnvCandidates());
		if (viaEnv) { return viaEnv; }

		// py 启动器：覆盖注册表里登记过的任意安装位置（包括不在 PATH 里的）
		const viaPy = await firstViable(await this.resolveViaPyLauncher());
		if (viaPy) { return viaPy; }

		// 常见安装目录
		const viaInstalled = await firstViable(this.listInstalledCandidates());
		if (viaInstalled) { return viaInstalled; }

		// sidecar 自建 venv —— 仅用于开发环境兜底
		const viaPackaged = await firstViable(this.listPackagedCandidates());
		if (viaPackaged) { return viaPackaged; }

		this.log('未找到可用的 Python 解释器。');
		if (explicit) {
			this.log(`  当前 incontrol.sidecar.pythonPath 指向 "${explicit}"，但该解释器不可用。`);
		}
		this.log('  处理方式（任选其一）：');
		this.log('    1) Windows x64 用户请重新安装包含内置 Python 的完整 Wibe 安装包；开发者运行 node build/python/prepare-runtime.mjs');
		this.log(`    2) 运行 ${path.join(this.opts.sidecarRoot, 'start.py')} 自动创建 venv 并安装依赖`);
		this.log('    3) 在设置 incontrol.sidecar.pythonPath 中指定一个已装好依赖的解释器');
		for (const f of failures.slice(0, 5)) {
			this.log(`  已排除：${f}`);
		}
		return undefined;
	}

	/**
	 * 启动 sidecar。
	 *
	 * 若目标端口上已有健康实例（用户手动起的、或上次未清理干净的），
	 * 直接复用而不重复 spawn —— 避免两个实例抢同一个 chrome_profile。
	 */
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

		// 解释器必须是"能跑且依赖齐全"的才会被返回；先解析解释器再动浏览器，
		// 免得选不出来时已经白白拉起一个 Chrome。选不出来时立刻失败 ——
		// 不 spawn、也不进入 60 秒健康探测窗口，避免把配置问题伪装成超时。
		const python = await this.resolvePython();
		if (!python) {
			// 上一轮可能已经起过浏览器；这里补一刀确保不留孤儿
			await this.browser?.dispose();
			this.browser = undefined;
			// 没有解释器不是瞬时故障，重试没有意义，只会每 15 秒刷一次同样的日志
			this.stopHealthLoop();
			return {
				alive: false,
				port: this.port,
				error: '未找到可用的 Python 解释器，详见「uwa Sidecar」输出通道',
			};
		}

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
		this.log(`spawning: ${python} ${entry} (port ${this.port})`);
		this.proc = spawn(python, this.pythonArguments(python, [entry]), {
			cwd: this.opts.sidecarRoot,
			windowsHide: true,
			env: {
				...this.pythonEnvironment(python),
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
		// 没有这个监听，spawn 失败（最常见是 ENOENT：解释器路径不存在）
		// 会被完全吞掉，只表现为后续 60s 健康探测超时，极难定位。
		this.proc.on('error', err => {
			const e = err as NodeJS.ErrnoException;
			if (e.code === 'ENOENT') {
				this.log(`PYTHON_NOT_FOUND: cannot execute "${python}" — set incontrol.sidecar.pythonPath`);
			} else {
				this.log(`spawn error: ${e.code ?? ''} ${e.message}`);
			}
			this.proc = undefined;
		});

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
