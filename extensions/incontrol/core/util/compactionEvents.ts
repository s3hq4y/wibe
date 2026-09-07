/*---------------------------------------------------------------------------------------------
 *  压缩 / 切模型事件总线
 *
 *  core/util/conversationCompaction.ts 是 incon 的上游代码，直接在里面调
 *  vscode API 会造成两个问题：
 *    1. core/ 需要保持与 VS Code 解耦（它也被非 VS Code 宿主复用）
 *    2. 上游同步时会冲突
 *
 *  因此用一个极薄的事件总线解耦：core 侧只 emit，扩展侧订阅后再触发迁移。
 *--------------------------------------------------------------------------------------------*/

export interface CompactionCompletedEvent {
	sessionId: string;
	index: number;
	/** 压缩产出的结构化摘要 */
	summary: string;
	/** 当前会话的系统提示词，迁移时需要一并注入新对话 */
	systemPrompt?: string;
}

export interface ModelSwitchedEvent {
	previousModel?: string;
	newModel: string;
	/** 打包后的历史全文；超长时由订阅方决定压缩或截断 */
	packedHistory: string;
	systemPrompt?: string;
}

type Listener<T> = (e: T) => void | Promise<void>;

class Emitter<T> {
	private listeners: Listener<T>[] = [];

	on(fn: Listener<T>): () => void {
		this.listeners.push(fn);
		return () => {
			this.listeners = this.listeners.filter(l => l !== fn);
		};
	}

	async emit(e: T): Promise<void> {
		for (const l of this.listeners) {
			try {
				await l(e);
			} catch (err) {
				// 单个订阅者失败不影响其他订阅者，也不阻断压缩本身
				console.warn('[bridge] listener failed:', err);
			}
		}
	}

	get hasListeners(): boolean {
		return this.listeners.length > 0;
	}
}

/** 压缩完成 —— 需求 2 的触发源 */
export const onCompactionCompleted = new Emitter<CompactionCompletedEvent>();

/** 模型切换 —— 需求 3 的触发源 */
export const onModelSwitched = new Emitter<ModelSwitchedEvent>();
