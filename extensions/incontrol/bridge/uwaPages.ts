/*---------------------------------------------------------------------------------------------
 * uwa sidecar 页面 / 模型查询（需求 4）
 *
 * 只做只读查询（不修改 uwa 内部状态）：
 *   - fetchUwaTabs     -> GET /api/tab-pool/tabs
 *   - fetchUwaTabModels-> 优先 /tab/{index}/v1/models，失败退回按域名/预设路由
 *--------------------------------------------------------------------------------------------*/

export interface UwaPageTab {
	persistentIndex: number;
	url: string;
	domain: string;
	presetName: string | null;
	effectivePresetName: string | null;
	status: string;
	modelName: string;
}

export interface UwaPageModel {
	/** OpenAI models 列表里的 id（发请求时 model 字段用这个） */
	id: string;
	/** 网页展示名，缺省时与 id 相同 */
	displayName: string;
}

async function getJson(
	baseUrl: string,
	path: string,
	timeoutMs = 8_000,
): Promise<any> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(baseUrl + path, {
			signal: ctrl.signal,
			headers: { accept: "application/json" },
		});
		if (!res.ok) {
			throw new Error(`HTTP ${res.status} GET ${path}`);
		}
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

/** 列出 uwa 标签页池里的全部标签页（含持久编号/URL/预设/状态） */
export async function fetchUwaTabs(baseUrl: string): Promise<UwaPageTab[]> {
	const data = await getJson(baseUrl, "/api/tab-pool/tabs");
	const rawTabs: any[] = Array.isArray(data?.tabs) ? data.tabs : [];
	return rawTabs
		.filter(
			(t: any) =>
				t && typeof t.persistent_index === "number" && t.persistent_index >= 1,
		)
		.map((t: any) => ({
			persistentIndex: t.persistent_index,
			url: String(t.url ?? ""),
			domain: String(
				t.current_domain ?? t.route_domain ?? t.domain_route_prefix ?? "",
			).replace(/^\/url\//, ""),
			presetName:
				t.preset_name === null || t.preset_name === undefined
					? null
					: String(t.preset_name),
			effectivePresetName:
				t.effective_preset_name === null ||
				t.effective_preset_name === undefined
					? null
					: String(t.effective_preset_name),
			status: String(t.status ?? ""),
			modelName: String(
				t.exposed_model_name ?? t.model_name ?? t.model_name_override ?? "",
			),
		}));
}

function parseModelsPayload(data: any): UwaPageModel[] {
	const entries: any[] = Array.isArray(data?.data) ? data.data : [];
	const out: UwaPageModel[] = [];
	const seen = new Set<string>();
	for (const e of entries) {
		const id = String(e?.id ?? "").trim();
		if (!id || seen.has(id.toLowerCase())) {
			continue;
		}
		seen.add(id.toLowerCase());
		out.push({
			id,
			displayName: String(e?.display_name ?? e?.name ?? id).trim() || id,
		});
	}
	return out;
}

/** 取指定标签页的模型列表；先后尝试固定标签页路由与域名/预设路由 */
export async function fetchUwaTabModels(
	baseUrl: string,
	tab: UwaPageTab,
): Promise<UwaPageModel[]> {
	const candidates: string[] = [];
	candidates.push(`/tab/${tab.persistentIndex}/v1/models`);
	if (tab.domain) {
		if (tab.effectivePresetName) {
			candidates.push(
				`/url/${encodeURIComponent(tab.domain)}/${encodeURIComponent(tab.effectivePresetName)}/v1/models`,
			);
		}
		candidates.push(`/url/${encodeURIComponent(tab.domain)}/v1/models`);
	}

	for (const path of candidates) {
		try {
			const data = await getJson(baseUrl, path);
			const models = parseModelsPayload(data);
			if (models.length > 0) {
				return models;
			}
		} catch {
			// 尝试下一个路由
		}
	}
	return [];
}
