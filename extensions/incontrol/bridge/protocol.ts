/*---------------------------------------------------------------------------------------------
 *  IDE <-> uwa-sidecar 桥接协议 (TypeScript 侧)
 *
 *  与 resources/uwa-sidecar/bridge/protocol.py 是同一份契约的两种语言表达。
 *  修改任一侧都必须同步另一侧，并同时更新 PROTOCOL_VERSION。
 *--------------------------------------------------------------------------------------------*/

export const PROTOCOL_VERSION = 1;

/** sidecar 默认监听端口；被占用时由扩展改写并通过 --port 传入 */
export const DEFAULT_SIDECAR_PORT = 8199;

/**
 * 多轮历史模式。
 * - auto / full / last 为 uwa 上游既有模式
 * - ide 为本项目新增：行为类似 last（只发最后一句），但「是否新建对话」
 *   不再由 uwa 依据 session.turns 推断，而是由 IDE 通过
 *   forceNewConversation 显式命令。这是压缩 / 切模型迁移的前提。
 */
export type HistoryMode = 'auto' | 'full' | 'last' | 'ide';

/** 触发开新对话的原因，便于 uwa 侧日志与策略区分 */
export type NewConversationReason = 'compaction' | 'model_switch' | 'manual';

/** 系统提示词注入策略 */
export type SystemPromptMode =
	/** 仅在新建对话的首轮注入，续聊不重复发送 */
	| 'inject_once'
	/** 每轮都发（等价上游行为） */
	| 'always'
	/** 从不由桥接层注入 */
	| 'never';

/** 请求上带的桥接扩展字段（挂在 OpenAI 请求体根节点） */
export interface UwaRequestExtension {
	history_mode?: HistoryMode;
	/** true 时强制开新对话，忽略会话亲和 */
	force_new_conversation?: boolean;
	system_prompt_mode?: SystemPromptMode;
	conversation_hint?: {
		reason: NewConversationReason;
		/** 迁移前的对话 URL，用于日志追踪与失败回滚 */
		prev_conversation_url?: string;
	};
}

/** 响应里回传的会话状态（挂在响应根节点 `x_uwa`） */
export interface UwaResponseExtension {
	/** 网页侧对话的完整 URL，例如 https://arena.ai/c/abc123 */
	conversation_url: string;
	/** URL 的路径部分，SPA 站点首轮前可能为空串 */
	conversation_id: string;
	/** 承载该对话的标签页序号 */
	tab_index: number;
	/** 已完成的轮次数 */
	turn: number;
	history_mode: HistoryMode;
	/** 本轮实际打进输入框的字符数 */
	typed_chars?: number;
	/** 若打完整历史需要的字符数，用于判断压缩收益 */
	full_chars?: number;
}

/**
 * IDE 侧维护的会话绑定状态机。
 *
 *   IDLE ──创建──> BOUND ──续聊──> BOUND
 *                   │
 *                   ├─压缩/切模型─> MIGRATING ─> BOUND(新 url)
 *                   └─失联/超时──> DESYNCED (需用户干预)
 *
 * DESYNCED 不可省略：网页标签页随时可能被用户手动关闭、刷新，
 * 或被 Cloudflare 盾拦截，此时 IDE 记录的 URL 已不可信。
 */
export type SessionBindingState = 'IDLE' | 'BOUND' | 'MIGRATING' | 'DESYNCED';

export interface SessionBinding {
	state: SessionBindingState;
	conversationUrl?: string;
	conversationId?: string;
	tabIndex?: number;
	turn: number;
	/** 本地估算的 token 数（网页侧真实值不可知，UI 需标注为估算） */
	estimatedTokens: number;
	lastUpdatedAt: number;
}

/** sidecar 健康状态 */
export interface SidecarHealth {
	alive: boolean;
	port: number;
	pid?: number;
	/** 浏览器是否已就绪 */
	browserReady?: boolean;
	error?: string;
}

/** 迁移请求：压缩后或切模型后把上下文搬到新对话 */
export interface MigrationRequest {
	reason: NewConversationReason;
	systemPrompt: string;
	/** 压缩摘要，或打包后的历史全文 */
	payload: string;
	prevConversationUrl?: string;
	/** 目标路由；切模型跨站点时需要 */
	routeDomain?: string;
	presetName?: string;
}

export interface MigrationResult {
	ok: boolean;
	conversationUrl?: string;
	conversationId?: string;
	tabIndex?: number;
	turn?: number;
	estimatedTokens?: number;
	error?: string;
}
