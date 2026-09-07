/*---------------------------------------------------------------------------------------------
 *  需求 2/3 的触发点
 *
 *  incon-mini 已有压缩能力（core/util/conversationCompaction.ts）与模型选择
 *  （gui/src/redux/slices/configSlice.ts）。缺的是「完成之后把上下文搬到新
 *  网页对话」这一步。本文件提供两个可直接调用的触发函数。
 *
 *  调用位置建议：
 *    - onCompactionComplete: core/util/conversationCompaction.ts 压缩成功后
 *    - onModelSwitch:        gui 侧 selectedModelByRole.chat 变化时
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** 模型 -> uwa 路由映射。切模型常意味着换站点，必须显式映射。 */
export interface ModelRoute {
	/** uwa 的 route_domain，如 "arena.ai" / "gemini.google.com" */
	routeDomain?: string;
	/** uwa 的 preset_name，用于同站点下的不同配置 */
	presetName?: string;
}

/**
 * 从 VS Code 配置读取模型路由表。
 *
 * 配置示例（settings.json）：
 *   "incontrol.bridge.modelRoutes": {
 *     "gemini-2.5-pro": { "routeDomain": "gemini.google.com" },
 *     "deepseek-chat":  { "routeDomain": "chat.deepseek.com", "presetName": "expert" }
 *   }
 */
export function resolveModelRoute(modelName: string): ModelRoute {
	const table = vscode.workspace
		.getConfiguration('incontrol.bridge')
		.get<Record<string, ModelRoute>>('modelRoutes') ?? {};

	// 精确匹配优先，其次前缀匹配（便于 "gpt-4o-2024-xx" 落到 "gpt-4o"）
	if (table[modelName]) {
		return table[modelName];
	}
	const prefixKey = Object.keys(table)
		.filter(k => modelName.startsWith(k))
		.sort((a, b) => b.length - a.length)[0];
	return prefixKey ? table[prefixKey] : {};
}

/**
 * 需求 2：压缩完成后调用。
 *
 * incon 的压缩产出是一段结构化摘要（会话概览/活跃开发/技术栈/文件操作/
 * 问题排查/待办）。这里把它连同系统提示词一起送进一个全新的网页对话。
 */
export async function onCompactionComplete(
	systemPrompt: string,
	summary: string,
): Promise<void> {
	if (!summary?.trim()) {
		return;
	}
	await vscode.commands.executeCommand('incontrol.bridge.compactAndMigrate', {
		systemPrompt,
		summary,
	});
}

/** 网页输入框长度上限的保守估计；超过则先压缩再迁移 */
const WEB_INPUT_SOFT_LIMIT = 30_000;

/**
 * 需求 3：切换模型时调用。
 *
 * 注意：裸发全量历史会撞网页输入框字数上限（Gemini/DeepSeek 都有限制）。
 * 因此超过阈值时先走压缩，再迁移 —— 复用需求 2 的链路而不是另起一套。
 */
export async function onModelSwitch(
	newModelName: string,
	systemPrompt: string,
	packedHistory: string,
	compactFn?: (text: string) => Promise<string>,
): Promise<void> {
	let payload = packedHistory;

	if (payload.length > WEB_INPUT_SOFT_LIMIT) {
		if (compactFn) {
			const choice = await vscode.window.showInformationMessage(
				`历史约 ${payload.length} 字符，超过网页输入框上限。` +
				`是否先压缩再迁移？`,
				{ modal: false },
				'压缩后迁移',
				'截断尾部迁移',
			);
			if (choice === '压缩后迁移') {
				payload = await compactFn(payload);
			} else if (choice === '截断尾部迁移') {
				payload = payload.slice(-WEB_INPUT_SOFT_LIMIT);
			} else {
				return; // 用户取消
			}
		} else {
			payload = payload.slice(-WEB_INPUT_SOFT_LIMIT);
		}
	}

	const route = resolveModelRoute(newModelName);
	await vscode.commands.executeCommand('incontrol.bridge.migrateOnModelSwitch', {
		systemPrompt,
		packedHistory: payload,
		routeDomain: route.routeDomain,
		presetName: route.presetName,
	});
}
