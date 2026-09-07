/*---------------------------------------------------------------------------------------------
 *  桥接层激活入口
 *
 *  把 sidecarManager / conversationBridge 接进扩展生命周期，并注册
 *  需求 2（压缩迁移）、需求 3（切模型迁移）的命令与事件。
 *
 *  在 extension.ts 的 activate() 里调用 activateBridge(context)，
 *  在 deactivate() 里 await 返回值的 dispose()。
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { onCompactionCompleted, onModelSwitched } from '../core/util/compactionEvents';
import { ConversationBridge } from './conversationBridge';
import { onCompactionComplete, onModelSwitch } from './bridgeTriggers';
import { MigrationResult, SessionBinding } from './protocol';
import { SidecarManager } from './sidecarManager';

let sidecar: SidecarManager | undefined;
let bridge: ConversationBridge | undefined;
let statusItem: vscode.StatusBarItem | undefined;
let output: vscode.OutputChannel | undefined;

/** 供 core/ 侧调用，拿到当前桥接实例 */
export function getBridge(): ConversationBridge | undefined {
	return bridge;
}

export function getSidecarBaseUrl(): string | undefined {
	return sidecar?.getBaseUrl();
}

function renderStatus(b: SessionBinding | undefined): void {
	if (!statusItem) {
		return;
	}
	if (!b || b.state === 'IDLE') {
		statusItem.text = '$(circle-outline) uwa: idle';
		statusItem.tooltip = '尚未绑定网页对话';
		statusItem.backgroundColor = undefined;
	} else if (b.state === 'BOUND') {
		statusItem.text = `$(link) uwa: turn ${b.turn}`;
		statusItem.tooltip =
			`已绑定网页对话\n${b.conversationUrl}\n` +
			`轮次 ${b.turn} · 约 ${b.estimatedTokens} tokens（本地估算）`;
		statusItem.backgroundColor = undefined;
	} else if (b.state === 'MIGRATING') {
		statusItem.text = '$(sync~spin) uwa: 迁移中';
		statusItem.tooltip = '正在把上下文迁移到新对话';
		statusItem.backgroundColor = undefined;
	} else {
		statusItem.text = '$(warning) uwa: 失联';
		statusItem.tooltip =
			'网页对话与 IDE 记录不一致。\n' +
			'可能是标签页被关闭、刷新，或被 Cloudflare 拦截。\n' +
			'点击可重新绑定。';
		statusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
	}
	statusItem.show();
}

/** 迁移结果统一提示；失败时明确告知用户仍在旧对话 */
async function reportMigration(res: MigrationResult, what: string): Promise<void> {
	if (res.ok) {
		vscode.window.setStatusBarMessage(
			`$(check) ${what}完成，已切换到新对话（约 ${res.estimatedTokens} tokens）`,
			5000,
		);
	} else {
		const open = '查看日志';
		const picked = await vscode.window.showErrorMessage(
			`${what}失败：${res.error}\n仍停留在原对话，上下文未丢失。`,
			open,
		);
		if (picked === open) {
			output?.show();
		}
	}
	renderStatus(bridge?.getBinding());
}

/**
 * 状态栏渲染 sidecar 运行状态。
 * 与 renderStatus（渲染对话绑定）分开：sidecar 未启动时对话绑定必然为空，
 * 此时更该告诉用户「点这里可以启动」，而不是显示一个空绑定。
 */
function renderSidecarStatus(alive: boolean): void {
	if (!statusItem) { return; }
	const show = vscode.workspace
		.getConfiguration('incontrol.sidecar')
		.get<boolean>('showStatusBar') !== false;
	if (!show) { statusItem.hide(); return; }
	statusItem.text = alive ? '$(radio-tower) uwa' : '$(circle-slash) uwa';
	statusItem.tooltip = alive
		? 'uwa sidecar 运行中 — 点击查看状态'
		: 'uwa sidecar 未运行 — 点击启动';
	statusItem.backgroundColor = alive
		? undefined
		: new vscode.ThemeColor('statusBarItem.warningBackground');
	statusItem.show();
}

export interface BridgeHandle {
	dispose(): Promise<void>;
}

export async function activateBridge(
	context: vscode.ExtensionContext,
): Promise<BridgeHandle> {
	output = vscode.window.createOutputChannel('uwa Sidecar');
	context.subscriptions.push(output);

	const log = (line: string) => output?.appendLine(line);

	// resources/uwa-sidecar 相对扩展目录的位置：
	// 开发态 extensions/incontrol -> ../../resources/uwa-sidecar
	// 打包态 resources/app/extensions/incontrol -> 同样成立
	const sidecarRoot = path.join(
		context.extensionPath, '..', '..', 'resources', 'uwa-sidecar',
	);

	const cfg = vscode.workspace.getConfiguration('incontrol.sidecar');

	sidecar = new SidecarManager({
		sidecarRoot,
		browserPort: cfg.get<number>('browserPort') ?? 9222,
		browserPath: cfg.get<string>('browserPath') || undefined,
		pythonPath: cfg.get<string>('pythonPath') || undefined,
		preferredPort: cfg.get<number>('port') ?? 8199,
		log,
	});

	bridge = new ConversationBridge({
		getBaseUrl: () => sidecar!.getBaseUrl(),
		log,
	});

	statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
	statusItem.command = 'incontrol.bridge.status';
	context.subscriptions.push(statusItem);
	renderStatus(bridge.getBinding());
	renderSidecarStatus(false);

	// ------------------------------------------------------------ 命令注册
	context.subscriptions.push(
		/** 手动启动 sidecar（autoStart 关闭、或自动启动失败时使用） */
		vscode.commands.registerCommand('incontrol.bridge.startSidecar', async () => {
			if (!sidecar) { return; }
			const health = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: '正在启动 uwa sidecar…' },
				() => sidecar!.start(),
			);
			renderSidecarStatus(health.alive);
			if (health.alive) {
				vscode.window.showInformationMessage(`uwa sidecar 已就绪：${sidecar!.getBaseUrl()}`);
			} else {
				const seeLog = '查看日志';
				const picked = await vscode.window.showErrorMessage('uwa sidecar 启动失败。', seeLog);
				if (picked === seeLog) { output?.show(); }
			}
		}),

		/** 手动停止 sidecar（连同其拉起的受控浏览器） */
		vscode.commands.registerCommand('incontrol.bridge.stopSidecar', async () => {
			if (!sidecar) { return; }
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: '正在停止 uwa sidecar…' },
				() => sidecar!.stop(),
			);
			renderSidecarStatus(false);
			vscode.window.showInformationMessage('uwa sidecar 已停止。');
		}),

		/** 状态面板：状态栏点击入口，按当前运行状态给出可用操作 */
		vscode.commands.registerCommand('incontrol.bridge.status', async () => {
			const alive = sidecar ? (await sidecar.checkHealth()).alive : false;
			const b = bridge?.getBinding();
			const items: vscode.QuickPickItem[] = alive
				? [
					{ label: '$(debug-disconnect) 停止 sidecar', description: sidecar?.getBaseUrl() },
					{ label: '$(refresh) 重启 sidecar' },
					{ label: '$(link-external) 查看当前网页对话', description: b?.conversationUrl ?? '尚未绑定' },
					{ label: '$(output) 查看 sidecar 日志' },
				]
				: [
					{ label: '$(play) 启动 sidecar', description: '拉起受控浏览器与 uwa 服务' },
					{ label: '$(output) 查看 sidecar 日志' },
				];
			const picked = await vscode.window.showQuickPick(items, {
				title: `uwa sidecar · ${alive ? '运行中' : '未运行'}`,
				placeHolder: alive ? `轮次 ${b?.turn ?? 0} · 状态 ${b?.state ?? 'IDLE'}` : '当前未运行',
			});
			if (!picked) { return; }
			if (picked.label.includes('启动')) {
				await vscode.commands.executeCommand('incontrol.bridge.startSidecar');
			} else if (picked.label.includes('停止')) {
				await vscode.commands.executeCommand('incontrol.bridge.stopSidecar');
			} else if (picked.label.includes('重启')) {
				await vscode.commands.executeCommand('incontrol.bridge.restartSidecar');
			} else if (picked.label.includes('对话')) {
				await vscode.commands.executeCommand('incontrol.bridge.showConversation');
			} else {
				output?.show();
			}
		}),

		/** 需求 1：查看/打开当前绑定的网页对话 */
		vscode.commands.registerCommand('incontrol.bridge.showConversation', async () => {
			const b = bridge?.getBinding();
			if (!b?.conversationUrl) {
				vscode.window.showInformationMessage('尚未绑定网页对话。发送一条消息后会自动绑定。');
				return;
			}
			const openIt = '在浏览器打开';
			const copy = '复制 URL';
			const rebind = b.state === 'DESYNCED' ? '标记为已重新绑定' : undefined;
			const picked = await vscode.window.showInformationMessage(
				`对话 URL：${b.conversationUrl}\n轮次 ${b.turn} · 状态 ${b.state}`,
				...[openIt, copy, ...(rebind ? [rebind] : [])],
			);
			if (picked === openIt) {
				vscode.env.openExternal(vscode.Uri.parse(b.conversationUrl));
			} else if (picked === copy) {
				await vscode.env.clipboard.writeText(b.conversationUrl);
				vscode.window.setStatusBarMessage('$(check) URL 已复制', 3000);
			} else if (picked === rebind) {
				bridge?.applyResponseExtension({
					conversation_url: b.conversationUrl,
					conversation_id: b.conversationId ?? '',
					tab_index: b.tabIndex ?? -1,
					turn: b.turn,
					history_mode: 'ide',
				});
				renderStatus(bridge?.getBinding());
			}
		}),

		/** 需求 2：压缩当前对话并迁移到新的网页对话 */
		vscode.commands.registerCommand(
			'incontrol.bridge.compactAndMigrate',
			async (args?: { systemPrompt?: string; summary?: string }) => {
				if (!bridge) { return; }
				const summary = args?.summary;
				if (!summary) {
					vscode.window.showWarningMessage(
						'没有可用的压缩摘要。请先执行对话压缩（Compact Conversation）。',
					);
					return;
				}
				renderStatus({ ...bridge.getBinding(), state: 'MIGRATING' });
				const res = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: '压缩后迁移到新对话…' },
					() => bridge!.migrateAfterCompaction(args?.systemPrompt ?? '', summary),
				);
				await reportMigration(res, '压缩迁移');
			},
		),

		/** 需求 3：切换模型时把上下文迁移到新窗口 */
		vscode.commands.registerCommand(
			'incontrol.bridge.migrateOnModelSwitch',
			async (args?: {
				systemPrompt?: string;
				packedHistory?: string;
				routeDomain?: string;
				presetName?: string;
			}) => {
				if (!bridge || !args?.packedHistory) { return; }
				renderStatus({ ...bridge.getBinding(), state: 'MIGRATING' });
				const res = await vscode.window.withProgress(
					{ location: vscode.ProgressLocation.Notification, title: '切换模型，迁移上下文…' },
					() => bridge!.migrateOnModelSwitch(
						args.systemPrompt ?? '',
						args.packedHistory!,
						args.routeDomain,
						args.presetName,
					),
				);
				await reportMigration(res, '模型切换迁移');
			},
		),

		/** 运维：重启 sidecar */
		vscode.commands.registerCommand('incontrol.bridge.restartSidecar', async () => {
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Notification, title: '重启 uwa sidecar…' },
				async () => {
					await sidecar?.stop();
					const h = await sidecar?.start();
					if (h?.alive) {
						vscode.window.setStatusBarMessage(`$(check) sidecar 已就绪 :${h.port}`, 4000);
					} else {
						vscode.window.showErrorMessage(`sidecar 启动失败：${h?.error ?? 'unknown'}`);
						output?.show();
					}
				},
			);
		}),

		/** 运维：查看 sidecar 日志 */
		vscode.commands.registerCommand('incontrol.bridge.showLogs', () => output?.show()),
	);

	// ------------------------------------------------------------ 事件订阅
	// 需求 2：压缩完成 -> 自动迁移
	context.subscriptions.push({
		dispose: onCompactionCompleted.on(async (e) => {
			const enabled = vscode.workspace
				.getConfiguration('incontrol.bridge')
				.get<boolean>('autoMigrateOnCompaction') !== false;
			if (!enabled || !e.summary?.trim()) {
				return;
			}
			log(`compaction completed for session=${e.sessionId} idx=${e.index}`);
			await onCompactionComplete(e.systemPrompt ?? '', e.summary);
		}),
	});

	// 需求 3：切换模型 -> 自动迁移
	context.subscriptions.push({
		dispose: onModelSwitched.on(async (e) => {
			const enabled = vscode.workspace
				.getConfiguration('incontrol.bridge')
				.get<boolean>('autoMigrateOnModelSwitch') !== false;
			if (!enabled || !e.packedHistory?.trim()) {
				return;
			}
			log(`model switched ${e.previousModel ?? '?'} -> ${e.newModel}`);
			await onModelSwitch(e.newModel, e.systemPrompt ?? '', e.packedHistory);
		}),
	});

	// ------------------------------------------------------------ 启动 sidecar
	if (cfg.get<boolean>('autoStart') !== false) {
		void (async () => {
			const health = await sidecar!.start();
			renderSidecarStatus(health.alive);
			if (health.alive) {
				log(`sidecar ready on :${health.port}`);
			} else {
				log(`sidecar failed: ${health.error}`);
				const act = '查看日志';
				const picked = await vscode.window.showWarningMessage(
					`uwa sidecar 未能启动：${health.error}\n网页对话功能不可用。`,
					act,
				);
				if (picked === act) { output?.show(); }
			}
		})();
	}

	return {
		async dispose() {
			// 级联关闭：不做这一步会在用户机器上堆积孤儿 Chrome 进程，
			// 并导致下次启动时 chrome_profile 被占用
			await sidecar?.stop();
			sidecar = undefined;
			bridge = undefined;
		},
	};
}
