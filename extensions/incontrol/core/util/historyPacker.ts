/*---------------------------------------------------------------------------------------------
 * 会话历史打包器（需求 2 / 3 共用）
 *
 * 把 IDE 会话历史文本化为一段可发送的对话记录，供「压缩迁移」「切换模型迁移」
 * 把上下文送进新的网页对话。规则：
 *   - 只保留 system / user / assistant 内容，tool 等过程消息丢弃；
 *   - 图片等非文本 part 由 stripImages 过滤；
 *   - 若命中历史里的压缩摘要（conversationSummary）则前置标注；
 *   - 系统提示词取最后一次出现的 system 消息内容（通常历史里没有，则为空）。
 *--------------------------------------------------------------------------------------------*/

import { ChatHistoryItem, Session } from "../index.js";
import { stripImages } from "./messageContent.js";

/** content 可能为 undefined / 字符串 / part 数组；统一成纯文本，避免 stripImages 崩在空值上 */
function textOf(content: unknown): string {
	if (content === undefined || content === null) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return stripImages(content as never);
	}
	return "";
}

export interface PackedSessionContext {
	/** 文本化的对话记录（含摘要与 system 消息外的全部轮次） */
	packedHistory: string;
	/** 最后一次出现的系统提示词（无则为空串） */
	systemPrompt: string;
	/** 参与打包的 user/assistant 轮次数（排除 tool 等） */
	turnCount: number;
	/** 打包文本字符数，用于前端展示与超长截断判断 */
	charCount: number;
}

export function packSessionForMigration(
	session: Session,
): PackedSessionContext {
	const lines: string[] = [];
	let systemPrompt = "";
	let turnCount = 0;

	for (const item of (session?.history ?? []) as (ChatHistoryItem | undefined)[]) {
		if (!item || !item.message) {
			continue;
		}

		const msg = item.message as { role?: string; content?: unknown };
		const role = String(msg.role ?? "user").toLowerCase();

		if (item.conversationSummary) {
			const summary = textOf(
				(item.conversationSummary as unknown as string) ?? "",
			);
			if (summary) {
				lines.push(`[earlier conversation summary]\n${summary}`);
			}
		}

		if (role === "system") {
			const text = textOf(msg.content);
			if (text) {
				// 只保留最后一次系统提示词
				systemPrompt = text;
			}
			continue;
		}

		if (role === "tool" || role === "function" || role === "error") {
			continue;
		}

		if (role === "user" || role === "assistant") {
			turnCount += 1;
		}

		const text = textOf(msg.content);
		if (!text) {
			continue;
		}
		lines.push(`${role}: ${text}`);
	}

	const packedHistory = lines.join("\n\n");
	return {
		packedHistory,
		systemPrompt,
		turnCount,
		charCount: packedHistory.length,
	};
}
