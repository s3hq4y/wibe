/**
 * uwa 桥接请求上下文。
 *
 * 为什么需要它：日常聊天走 core/llm/llms/OpenAI.ts 直连 sidecar，
 * 而此前只有 bridge/conversationBridge.ts 的「迁移请求」才带 history_mode。
 * 结果 uwa 每轮都收不到模式标记，回落默认逻辑 —— 同一会话内反复点
 * new_chat_btn 开新对话，需求 0/1 完全失效。
 *
 * core/ 内禁止 import vscode，因此这里只维护纯数据，由扩展侧写入。
 */

export type UwaHistoryMode = 'auto' | 'full' | 'last' | 'ide';
export type UwaSystemPromptMode = 'inject_once' | 'always' | 'never';

export interface UwaRequestFields {
	history_mode?: UwaHistoryMode;
	force_new_conversation?: boolean;
	system_prompt_mode?: UwaSystemPromptMode;
	conversation_hint?: {
		reason: 'compaction' | 'model_switch' | 'manual';
		prev_conversation_url?: string;
	};
}

let enabled = false;
let base: UwaRequestFields = {};
/** 一次性标记：只作用于下一个请求，用完即清 */
let oneShot: UwaRequestFields | undefined;

/** 扩展激活时开启；未开启则完全不影响非 uwa 用户 */
export function setUwaBridgeEnabled(on: boolean, defaults?: UwaRequestFields): void {
	enabled = on;
	if (defaults) { base = { ...base, ...defaults }; }
}

export function isUwaBridgeEnabled(): boolean {
	return enabled;
}

/**
 * 标记下一次请求需要开新对话（压缩迁移 / 模型切换）。
 * 只影响紧接着的一个请求，避免误伤后续续聊。
 */
export function markNextRequest(fields: UwaRequestFields): void {
	oneShot = { ...(oneShot ?? {}), ...fields };
}

/** 取出应合并进请求体的字段；消费掉一次性标记 */
export function consumeUwaFields(): UwaRequestFields | undefined {
	if (!enabled) { return undefined; }
	const merged: UwaRequestFields = { ...base, ...(oneShot ?? {}) };
	oneShot = undefined;
	return merged;
}
