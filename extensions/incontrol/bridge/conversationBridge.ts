/*---------------------------------------------------------------------------------------------
 *  会话桥接：URL 绑定 + 压缩迁移 + 切模型迁移
 *
 *  对应需求：
 *    1. 创建对话后记录聊天 URL
 *    2. 压缩后把系统提示词 + 摘要发到新对话，更新 URL 与 token
 *    3. 切换模型时把历史打包发到新窗口，更新 URL
 *--------------------------------------------------------------------------------------------*/

import {
	MigrationRequest,
	MigrationResult,
	SessionBinding,
	UwaRequestExtension,
	UwaResponseExtension,
} from './protocol';

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
}

export interface BridgeOptions {
	getBaseUrl: () => string;
	log?: (line: string) => void;
	/** 本地 token 估算；接 core/llm/countTokens.ts */
	countTokens?: (text: string) => number;
}

export class ConversationBridge {
	private binding: SessionBinding = {
		state: 'IDLE',
		turn: 0,
		estimatedTokens: 0,
		lastUpdatedAt: Date.now(),
	};

	constructor(private readonly opts: BridgeOptions) { }

	getBinding(): Readonly<SessionBinding> {
		return this.binding;
	}

	private log(m: string): void {
		this.opts.log?.(`[bridge] ${m}`);
	}

	private estimate(text: string): number {
		if (this.opts.countTokens) {
			try {
				return this.opts.countTokens(text);
			} catch {
				/* fallthrough */
			}
		}
		// 粗略回退：中英混排约 2.5 字符/token
		return Math.ceil(text.length / 2.5);
	}

	/** 需求 1：从响应里抓取 conversation_url 并更新绑定 */
	applyResponseExtension(ext: UwaResponseExtension | undefined): void {
		if (!ext || !ext.conversation_url) {
			return;
		}
		this.binding = {
			state: 'BOUND',
			conversationUrl: ext.conversation_url,
			conversationId: ext.conversation_id,
			tabIndex: ext.tab_index,
			turn: ext.turn,
			estimatedTokens: this.binding.estimatedTokens,
			lastUpdatedAt: Date.now(),
		};
		this.log(`bound url=${ext.conversation_url} turn=${ext.turn}`);
	}

	/** 从任意响应体里提取 x_uwa 字段 */
	static extractExtension(body: any): UwaResponseExtension | undefined {
		const raw = body?.x_uwa;
		return raw && typeof raw === 'object' ? (raw as UwaResponseExtension) : undefined;
	}

	/** 标记失联：网页标签页被手动关闭 / 刷新 / 被 CF 盾拦截 */
	markDesynced(reason: string): void {
		this.log(`DESYNCED: ${reason}`);
		this.binding = { ...this.binding, state: 'DESYNCED', lastUpdatedAt: Date.now() };
	}

	/** 构造带桥接字段的请求体扩展 */
	buildRequestExtension(forceNew: boolean, reason?: MigrationRequest['reason']): UwaRequestExtension {
		return {
			history_mode: 'ide',
			force_new_conversation: forceNew,
			system_prompt_mode: 'inject_once',
			...(forceNew
				? {
					conversation_hint: {
						reason: reason ?? 'manual',
						prev_conversation_url: this.binding.conversationUrl,
					},
				}
				: {}),
		};
	}

	/**
	 * 需求 2 & 3 的公共实现：把上下文迁移到一个全新的网页对话。
	 *
	 * 事务语义：失败时不丢弃旧 URL，而是回滚绑定并标记 DESYNCED，
	 * 让用户能看到"迁移失败，仍在旧对话"而不是静默错乱。
	 */
	async migrate(req: MigrationRequest): Promise<MigrationResult> {
		const prev = { ...this.binding };
		this.binding = { ...this.binding, state: 'MIGRATING', lastUpdatedAt: Date.now() };
		this.log(`migrating reason=${req.reason} from=${prev.conversationUrl ?? '(none)'}`);

		const messages: ChatMessage[] = [];
		if (req.systemPrompt) {
			messages.push({ role: 'system', content: req.systemPrompt });
		}
		messages.push({ role: 'user', content: req.payload });

		// 切模型可能跨站点，需要走 uwa 的按域名路由
		const base = this.opts.getBaseUrl();
		const routePath = req.routeDomain
			? req.presetName
				? `/url/${encodeURIComponent(req.routeDomain)}/${encodeURIComponent(req.presetName)}/v1/chat/completions`
				: `/url/${encodeURIComponent(req.routeDomain)}/v1/chat/completions`
			: '/v1/chat/completions';

		try {
			const res = await fetch(base + routePath, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model: 'default',
					messages,
					stream: false,
					...this.buildRequestExtension(true, req.reason),
				}),
			});

			if (!res.ok) {
				throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
			}

			const body: any = await res.json();
			const ext = ConversationBridge.extractExtension(body);

			if (!ext?.conversation_url) {
				throw new Error('sidecar did not return conversation_url');
			}

			const tokens = this.estimate(req.systemPrompt + '\n' + req.payload);
			this.binding = {
				state: 'BOUND',
				conversationUrl: ext.conversation_url,
				conversationId: ext.conversation_id,
				tabIndex: ext.tab_index,
				turn: ext.turn || 1,
				estimatedTokens: tokens,
				lastUpdatedAt: Date.now(),
			};

			this.log(`migrated -> ${ext.conversation_url} (~${tokens} tokens est.)`);
			return {
				ok: true,
				conversationUrl: ext.conversation_url,
				conversationId: ext.conversation_id,
				tabIndex: ext.tab_index,
				estimatedTokens: tokens,
			};
		} catch (e: any) {
			const msg = String(e?.message ?? e);
			this.log(`migration failed: ${msg}`);
			// 回滚：保留旧 URL，但标记为需用户确认
			this.binding = { ...prev, state: 'DESYNCED', lastUpdatedAt: Date.now() };
			return { ok: false, error: msg };
		}
	}

	/** 需求 2：压缩完成后调用 */
	async migrateAfterCompaction(systemPrompt: string, summary: string): Promise<MigrationResult> {
		return this.migrate({
			reason: 'compaction',
			systemPrompt,
			payload: summary,
			prevConversationUrl: this.binding.conversationUrl,
		});
	}

	/**
	 * 需求 3：切换模型时调用。
	 *
	 * 注意 packedHistory 可能很长而网页输入框有字数上限；调用方应先用
	 * conversationCompaction 压缩，再走这里，而不是裸发全文。
	 */
	async migrateOnModelSwitch(
		systemPrompt: string,
		packedHistory: string,
		routeDomain?: string,
		presetName?: string,
	): Promise<MigrationResult> {
		return this.migrate({
			reason: 'model_switch',
			systemPrompt,
			payload: packedHistory,
			prevConversationUrl: this.binding.conversationUrl,
			routeDomain,
			presetName,
		});
	}
}
