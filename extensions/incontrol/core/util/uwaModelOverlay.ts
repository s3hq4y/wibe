/*---------------------------------------------------------------------------------------------
 * uwa 网页模型覆盖层（内存态，需求 4）
 *
 * 「同步网页模型」把 uwa 当前网页的可用模型登记到这里；
 * core/config/load.ts 装配配置时把它们以 ModelDescription 形式追加进
 * 序列化配置（仅影响本进程内的加载结果，绝不改写用户 config.yaml）。
 *
 * core/ 内禁止 import vscode：本模块只维护纯数据 + 变更订阅，
 * 写入与订阅由扩展宿主（bridge）完成。
 *--------------------------------------------------------------------------------------------*/

import type { JSONModelDescription } from "..";

export interface UwaSyncedModel {
	/** 展示名 / 选择名（同时作为配置里的 model title） */
	title: string;
	/** 发往 sidecar 的 OpenAI model 字段 */
	model: string;
	/** sidecar OpenAI 兼容端点，例如 http://127.0.0.1:8199/v1 */
	apiBase: string;
}

let synced: UwaSyncedModel[] = [];
const listeners = new Set<(models: UwaSyncedModel[]) => void>();

export function getUwaSyncedModels(): UwaSyncedModel[] {
	return synced;
}

export function hasUwaSyncedModels(): boolean {
	return synced.length > 0;
}

export function setUwaSyncedModels(models: UwaSyncedModel[]): void {
	synced = [...models];
	for (const listener of [...listeners]) {
		try {
			listener(synced);
		} catch (err) {
			console.warn("[uwa] overlay listener failed:", err);
		}
	}
}

export function clearUwaSyncedModels(): void {
	setUwaSyncedModels([]);
}

/** 订阅覆盖层变化；返回退订函数 */
export function onUwaSyncedModelsChanged(
	fn: (models: UwaSyncedModel[]) => void,
): () => void {
	listeners.add(fn);
	return () => {
		listeners.delete(fn);
	};
}

/**
 * 把同步进来的网页模型追加到 serialized config 的 models 列表（按 title 去重）。
 * 由 core/config/load.ts 在装配配置时调用；纯函数、无副作用。
 */
export function applyUwaModelsToSerialized(serialized: {
	models?: JSONModelDescription[];
}): void {
	const uwaModels = getUwaSyncedModels();
	if (uwaModels.length === 0) {
		return;
	}

	const models: JSONModelDescription[] = serialized.models ?? [];
	if (!Array.isArray(models)) {
		return;
	}

	const knownTitles = new Set(models.map((m) => m.title));
	for (const m of uwaModels) {
		if (knownTitles.has(m.title)) {
			continue;
		}
		models.push({
			title: m.title,
			provider: "openai",
			underlyingProviderName: "openai",
			model: m.model,
			apiBase: m.apiBase,
			// The sidecar drives a real browser conversation and performs the
			// image upload itself, independently of whether the underlying web
			// model is multimodal. Without this, `modelSupportsImages` falls back
			// to name heuristics that miss many synced web models (e.g. gpt-5,
			// gemini-2.5), and `compileChatMessages` strips the `imageUrl` parts
			// produced by fetch_image before they ever reach the sidecar.
			capabilities: { uploadImage: true },
		} satisfies JSONModelDescription);
		knownTitles.add(m.title);
	}
}
