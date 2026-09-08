/**
 * uwa 桥接请求上下文。
 *
 * 为什么需要它：日常聊天走 core/llm/llms/OpenAI.ts 直连 sidecar，
 * 而此前只有 bridge/conversationBridge.ts 的「迁移请求」才带 history_mode。
 * 结果 uwa 每轮都收不到模式标记，回落默认逻辑 —— 同一会话内反复点
 * new_chat_btn 开新对话，需求 0/1 完全失效。
 *
 * core/ 内禁止 import vscode，因此这里只维护纯数据，由扩展侧写入。
 *
 * 除请求字段外，本模块还持有「当前绑定的网页对话 URL」：
 *   - 发送前：OpenAI 客户端读取它，若受控浏览器不在该对话页则先导航回去
 *     （需求：切回历史会话时网页对话保持一致）；
 *   - 响应后：从 x_uwa 解析到新 URL 时写回（setUwaConversationState），
 *     并通知订阅者（bridge 层借此刷新状态栏与迁移用的 binding）。
 */

import { createHash } from 'crypto';

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

/** 会话绑定快照：只含跨 core/bridge 共享的最小信息 */
export interface UwaConversationState {
	conversationUrl: string;
	conversationId: string;
	tabIndex: number;
	turn: number;
	updatedAt: number;
}

let enabled = false;
let sidecarBaseUrl = '';
let base: UwaRequestFields = {};
/** 一次性标记：只作用于下一个请求，用完即清 */
let oneShot: UwaRequestFields | undefined;

/**
 * 网页对话绑定按「IDE 会话指纹」分槽保存。
 *
 * 为什么需要分槽：扩展可同时打开多个 IDE 会话（会话 A/B 各绑定一个网页
 * 对话）。旧实现是单一全局 state——切回会话 A 续聊时，发送前断言读到的
 * 仍是会话 B 的绑定 URL，消息被定向/导航到 B 的网页对话（串台）。
 * 会话槽键优先用 GUI 聊天请求携带的 IDE 会话 id（llm/streamChat.sessionId，
 * 见 uwaConversationFingerprint）；无会话键的调用方才回退首条 user 文本指纹。
 *
 * 槽表带 LRU 上限；另外保留「最近一次」引用供不携带指纹的调用方
 * （bridge 迁移直发等）与状态栏展示使用。
 */
const MAX_SLOTS = 64;
const slots = new Map<string, UwaConversationState>();
let conversation: UwaConversationState | undefined;
const listeners = new Set<(state: UwaConversationState | undefined) => void>();

/** 扩展激活时开启；未开启则完全不影响非 uwa 用户 */
export function setUwaBridgeEnabled(on: boolean, defaults?: UwaRequestFields): void {
	enabled = on;
	if (defaults) { base = { ...base, ...defaults }; }
}

export function isUwaBridgeEnabled(): boolean {
	return enabled;
}

	/** 登记受控 sidecar 的 API 根（如 http://127.0.0.1:8199）；桥接激活后写入 */
	export function setUwaSidecarBaseUrl(base: string): void {
		sidecarBaseUrl = String(base ?? '').trim().replace(/\/+$/, '');
	}

	/** 该模型的 apiBase 是否指向受控 sidecar；用于把 uwa 字段/定向只作用到 sidecar 模型 */
	export function isUwaModelApiBase(apiBase?: string): boolean {
		if (!enabled || !sidecarBaseUrl) { return false; }
		const base = String(apiBase ?? '').trim().replace(/\/+$/, '');
		return base.startsWith(sidecarBaseUrl + '/');
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

/**
 * 会话绑定槽键：优先使用 IDE 会话 id（llm/streamChat.sessionId 载荷）直接作键——
 * 同一会话任意轮次不变；不同会话即使首条 user 文本相同（如都从同一条手动系统
 * 提示词起步）也不共槽。拿不到会话 id 的调用方（slash/工具直发等）才回退
 * messages 第一条 user 文本（跳过 system/工具）的 sha1 摘要——该路径要求不同
 * 会话首条 user 不同，否则会共槽（已知限制）。
 */
/** 会话绑定槽键（以 IDE 会话 id 直接作键）：同一会话任意轮次不变；
 *  不同会话即使首条 user 文本相同也不共槽。供 bridge 在压缩迁移等
 *  场景按会话 id 精确读写绑定。 */
export function uwaSessionFingerprint(
	sessionId?: string | null,
): string | undefined {
	const sid = String(sessionId ?? '').trim();
	if (!sid) {
		return undefined;
	}
	return createHash('sha1').update(`sid:${sid}`).digest('hex').slice(0, 20);
}

export function uwaConversationFingerprint(
	messages: { role?: string; content?: unknown }[],
	sessionKey?: string | null,
): string | undefined {
	const fp = uwaSessionFingerprint(sessionKey);
	if (fp) {
		return fp;
	}
	for (const m of messages || []) {
		if (m && String(m.role ?? '').toLowerCase() === 'user') {
			const text = Array.isArray(m.content)
				? JSON.stringify(m.content)
				: String(m.content ?? '');
			if (text && text.trim()) {
				return createHash('sha1').update(`user:${text}`).digest('hex').slice(0, 20);
			}
		}
	}
	return undefined;
}

/** 响应确认网页对话后写回绑定状态；URL/轮次变化时通知订阅者。
 *  fp 有值时写入该会话槽，同时刷新「最近一次」引用。 */
export function setUwaConversationState(
	state: UwaConversationState,
	fp?: string | undefined,
): void {
	const { conversationUrl, turn } = state;
	if (fp) {
		slots.delete(fp);
		slots.set(fp, { ...state, updatedAt: Date.now() });
		while (slots.size > MAX_SLOTS) {
			const oldest = slots.keys().next().value;
			if (oldest === undefined) { break; }
			slots.delete(oldest);
		}
	}
	const changed =
		!conversation ||
		conversation.conversationUrl !== conversationUrl ||
		conversation.turn !== turn;
	conversation = { ...state, updatedAt: Date.now() };
	if (changed) {
		for (const l of [...listeners]) {
			try { l(conversation); } catch { /* 订阅者异常不影响主流程 */ }
		}
	}
}

/**
 * 供发送前使用。
 *
 * 语义（重要）：带指纹时**只查本会话槽**，查不到返回 undefined——
 * 绝不回退到其它会话的绑定（否则切回旧会话 A（A 槽尚未建立，如旧版本
 * 遗留记录、或扩展重启后）续聊时，会把 A 的消息定向到最近会话 B 的
 * 网页对话，造成串台）。调用方拿到 undefined 就应走默认端点，让 sidecar
 * 按消息指纹自行路由；响应回写会把本会话槽补建起来。
 * 不带指纹（bridge 迁移等调用方）仍返回「最近一次」引用。
 */
export function getUwaConversationState(
	fp?: string | undefined,
): UwaConversationState | undefined {
	if (fp) {
		return slots.get(fp);
	}
	return conversation;
}

/** 需求 2：按 IDE 会话 id 读/写该会话自己的网页对话绑定槽。
 *  语义与 fp 版一致：查不到返回 undefined，绝不回退到其它会话的绑定
 *  （否则 A/B 多会话并行时压缩 A 可能把迁移目标/续聊串到 B）。 */
export function getUwaConversationStateForSession(
	sessionId?: string | null,
): UwaConversationState | undefined {
	const fp = uwaSessionFingerprint(sessionId);
	return fp ? getUwaConversationState(fp) : undefined;
}

export function setUwaConversationStateForSession(
	sessionId: string | null | undefined,
	state: UwaConversationState,
): boolean {
	const fp = uwaSessionFingerprint(sessionId);
	if (!fp) {
		return false;
	}
	setUwaConversationState(state, fp);
	return true;
}

/**
 * 会话「最近一次实际发出的 system」暂存（压缩迁移用）。
 *
 * 背景：GUI 的 system 是每次请求时按规则现组装（constructMessages →
 * getSystemMessageWithRules），只进请求体、不写会话历史。conversationCompaction
 * 压缩完成后要迁移到新网页对话，需要这份 system —— 若从历史里扫，通常为空
 * （丢系统提示词的根因）。因此 llm/streamChat 发送前把带 uwaSessionKey 的请求
 * 里 system 内容记到本会话槽（键同绑定槽：sha1("sid:"+sessionId)），压缩完成时
 * 按 sessionId 取用；取不到再回退历史扫描。
 */
const MAX_SYSTEM_PROMPTS = 32;
const systemPrompts = new Map<string, string>();

export function rememberUwaSystemPrompt(
	sessionKey?: string | null,
	systemText?: string | null,
): void {
	if (!enabled || !systemText || !systemText.trim()) {
		return;
	}
	const fp = uwaSessionFingerprint(sessionKey);
	if (!fp) {
		return;
	}
	systemPrompts.delete(fp);
	systemPrompts.set(fp, systemText);
	while (systemPrompts.size > MAX_SYSTEM_PROMPTS) {
		const oldest = systemPrompts.keys().next().value;
		if (oldest === undefined) { break; }
		systemPrompts.delete(oldest);
	}
}

export function getUwaSystemPrompt(
	sessionId?: string | null,
): string | undefined {
	const fp = uwaSessionFingerprint(sessionId);
	return fp ? systemPrompts.get(fp) : undefined;
}

/** 订阅绑定状态变化（bridge 层用于刷新状态栏 / binding） */
export function onUwaConversationChanged(
	listener: (state: UwaConversationState | undefined) => void,
): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** uwa 决策链路诊断日志（bridge 层注入到 "uwa Sidecar" 输出通道；无人注入时静默） */
let traceFn: ((line: string) => void) | undefined;
export function setUwaTrace(fn?: (line: string) => void): void {
	traceFn = fn;
}
export function uwaTrace(line: string): void {
	try {
		traceFn?.(`[uwa-route] ${line}`);
	} catch {
		/* ignore */
	}
}
