/*---------------------------------------------------------------------------------------------
 *  incontrol 扩展的 VS Code 构建适配层
 *
 *  incon-mini 原本用自己的 scripts/esbuild.js + Vite。内置扩展必须走 VS Code
 *  的 gulp 管线（build/gulpfile.extensions.ts 会自动发现 extensions/  * /esbuild.mts）。
 *  这里做的是把两者对接，而不是替换 —— GUI 仍然由 Vite 构建。
 *
 *  原生依赖说明（已实测）：
 *    - tree-sitter 是 WASM 版（web-tree-sitter + tree-sitter-wasms），无需编译
 *    - sqlite3 别名到 VS Code 自带的 @vscode/sqlite3（已针对 Electron 42 预编译）
 *    因此本扩展 0 个 .node 需要重新编译。
 *--------------------------------------------------------------------------------------------*/
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const rootDir = import.meta.dirname;
const srcDir = path.join(rootDir, 'src');
const outDir = path.join(rootDir, 'out');
const guiDir = path.join(rootDir, 'gui');
const mediaDir = path.join(rootDir, 'media');

/** 与 sidecar/核心逻辑无关的静态资源，直接拷贝 */
async function copyAssets(target: string): Promise<void> {
	// 1. src 下的非 TS 文件（.json 模板、.wasm 等）
	try {
		const entries = await fs.readdir(srcDir, { withFileTypes: true, recursive: true });
		for (const entry of entries) {
			if (!entry.isFile() || entry.name.endsWith('.ts')) {
				continue;
			}
			const srcPath = path.join(entry.parentPath, entry.name);
			const destPath = path.join(target, path.relative(srcDir, srcPath));
			await fs.mkdir(path.dirname(destPath), { recursive: true });
			await fs.copyFile(srcPath, destPath);
		}
	} catch { /* src 下无额外资源时忽略 */ }

	// 2. tree-sitter 的 .scm 查询文件必须随产品分发（运行时按路径读取）
	for (const dir of ['tree-sitter', 'tag-qry']) {
		const from = path.join(rootDir, dir);
		try {
			await fs.cp(from, path.join(target, '..', dir), { recursive: true });
		} catch { /* 目录不存在时跳过 */ }
	}

	// 3. GUI 产物（Vite 构建到 gui/dist，运行时由 webview 加载）
	try {
		await fs.access(path.join(guiDir, 'dist'));
		await fs.cp(path.join(guiDir, 'dist'), mediaDir, { recursive: true });
	} catch { /* GUI 未构建时跳过，见 buildGui() */ }
}

/**
 * 构建 React GUI。
 *
 * 放在 esbuild 之前同步执行：webview 资源缺失不会导致扩展加载失败，
 * 但会让侧边栏空白，属于必须尽早暴露的问题。
 */
function buildGui(): void {
	const isWatch = process.argv.includes('--watch');
	if (isWatch) {
		// watch 模式下 GUI 由开发者单独跑 `npm --prefix gui run dev`
		return;
	}
	const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
	const res = spawnSync(npm, ['run', 'build'], {
		cwd: guiDir,
		stdio: 'inherit',
		shell: process.platform === 'win32',
	});
	if (res.status !== 0) {
		console.warn('[incontrol] GUI build failed; webview assets may be stale');
	}
}

buildGui();

run({
	platform: 'node',
	entryPoints: {
		'extension': path.join(srcDir, 'extension.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		// vscode 由宿主注入；sqlite3 走 VS Code 自带的预编译版本，
		// 不能打进 bundle，否则 .node 路径解析会失败
		external: [
			'vscode',
			'sqlite3',
			'@vscode/sqlite3',
			'web-tree-sitter',
			// win-ca (transitive dep of core/util/ca setupCa) ships prebuilt
			// crypt32-*.node addons and resolves them via a computed require
			// on process.arch, which esbuild cannot statically bundle.
			'win-ca',
			'mac-ca',
			'esbuild',
		],
		// core/ 里有大量 CommonJS 依赖，保持 cjs 输出避免 ESM 互操作问题
		format: 'cjs',
		// tree-sitter 的 wasm 以文件形式加载
		// .node addons are emitted as files rather than inlined; anything
		// still reachable at build time must not abort the bundle.
		loader: { '.wasm': 'file', '.node': 'file' },
	},
}, process.argv, copyAssets);
