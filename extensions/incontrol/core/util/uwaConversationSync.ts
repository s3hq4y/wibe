/*---------------------------------------------------------------------------------------------
 * uwa 网页会话同步（发送前导航回记录中的对话）
 *
 * 场景：IDE 的历史会话已绑定某个网页对话 URL（如
 * https://chat.deepseek.com/a/chat/s/<uuid>）。若受控浏览器当前不在这
 * 个对话上（网页被手动切走、或扩展重启后浏览器停在别处），直接把消息
 * 发给 sidecar 会打错页面。本模块在发送前：
 *   1. 查询 sidecar 标签池，找 URL 匹配该会话的标签页；
 *   2. 找不到则让 sidecar 在其受控浏览器里打开该 URL（新标签并激活）；
 *   3. 有界轮询直到页面就位（不阻断失败：失败则静默跳过，消息照发）。
 *
 * 不修改 app/core/ 与站点配置；只使用 sidecar 既有 HTTP API。
 *--------------------------------------------------------------------------------------------*/

export interface UwaTabInfo {
	persistentIndex: number;
	url: string;
	/** tab-pool 直接暴露的浏览器上下文标识；open-profile-url 用它精确定位同一用户目录 */
	browserContextId?: string;
	/** tab-pool 的 url 路由令牌：/tab-url/<token>/v1/chat/completions 的确定性路由键 */
	urlRouteToken?: string;
}

async function getJson(baseUrl: string, path: string, timeoutMs = 5_000): Promise<any> {
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

/** 列出标签池中的网页标签（只保留有 URL 的远程页） */
export async function listUwaTabs(baseUrl: string): Promise<UwaTabInfo[]> {
	try {
		const data = await getJson(baseUrl, "/api/tab-pool/tabs");
		const raw: any[] = Array.isArray(data?.tabs) ? data.tabs : [];
		return raw
			.filter(
				(t: any) =>
					t &&
					typeof t.persistent_index === "number" &&
					t.persistent_index >= 1 &&
					String(t.url ?? "").startsWith("http"),
			)
			.map((t: any) => ({
				persistentIndex: t.persistent_index,
				url: String(t.url),
				browserContextId:
					typeof t.browser_context_id === "string" && t.browser_context_id
						? t.browser_context_id
						: undefined,
				urlRouteToken:
					typeof t.url_route_token === "string" && t.url_route_token
						? t.url_route_token
						: undefined,
			}));
	} catch {
		return [];
	}
}

/**
 * 判断 tab 是否停留在目标会话页。
 *
 * 规则：同一站点（origin 相同）且 tab.url 的 path 包含目标 path
 * （如 /a/chat/<uuid>）。path 为空/过短（首页之类）不算会话页。
 */
export function tabMatchesConversation(tabUrl: string, targetUrl: string): boolean {
	try {
		const tab = new URL(tabUrl);
		const target = new URL(targetUrl);
		if (tab.origin !== target.origin) {
			return false;
		}
		const path = target.pathname;
		if (path.length <= 1) {
			return false;
		}
		return tab.pathname.includes(path) || path.includes(tab.pathname);
	} catch {
		return false;
	}
}

/**
 * 为目标会话页准备“确定性路由”的发送地址。
 *
 * sidecar 的多标签路由默认按标签池轮询/亲和挑选空闲页；当受控浏览器
 * 同时开着多个对话页时，普通 /v1/chat/completions 可能把续聊消息分到
 * 别的会话页（实测：双标签交替轮询）。既有端点
 *   POST /tab-url/{url_route_token}/v1/chat/completions
 * 按 URL 精确锁定标签页，是发送前断言的正解：
 *   1. 查标签池找停靠在 targetUrl 的标签页及其 url_route_token；
 *   2. 页面不在（被手动关闭 / 池尚未收录）时先 open-profile-url 导航回
 *      targetUrl，再重查一次；
 *   3. 仍未就位则返回 null，调用方回退默认端点（不阻断发送）。
 *
 * @returns 完整请求 URL（如 http://127.0.0.1:8199/tab-url/<token>/v1/chat/completions），
 *          或 null（未就位，调用方走原路径）
 */
export async function prepareUwaTargetUrl(
	baseUrl: string,
	targetUrl: string,
	timeoutMs = 16_000,
): Promise<string | null> {
	if (!targetUrl?.startsWith("http")) {
		return null;
	}
	const tokenOf = async (): Promise<string | undefined> => {
		const tabs = await listUwaTabs(baseUrl);
		const tab = tabs.find((t) => tabMatchesConversation(t.url, targetUrl));
		return tab?.urlRouteToken;
	};

	// 1) 页面已在池中且带路由令牌 → 直接可用
	const have = await tokenOf();
	if (have) {
		return `${baseUrl.replace(/\/$/, "")}/tab-url/${have}/v1/chat/completions`;
	}

	// 2) 页面不在：先导航回 targetUrl（新标签并激活），SPA 收录后重查
	await ensureConversationPage(baseUrl, targetUrl, timeoutMs);
	const after = await tokenOf();
	if (after) {
		return `${baseUrl.replace(/\/$/, "")}/tab-url/${after}/v1/chat/completions`;
	}
	return null;
}

/**
 * 让受控浏览器停在 targetUrl 对应的会话页上（若已停靠则直接返回）。
 *
 * @param baseUrl  sidecar API 根，如 http://127.0.0.1:8199
 * @param targetUrl 目标会话 URL
 * @returns 是否就绪（false = 未导航成功，调用方应继续发送，不阻断）
 */
export async function ensureConversationPage(
	baseUrl: string,
	targetUrl: string,
	timeoutMs = 12_000,
): Promise<boolean> {
	if (!targetUrl?.startsWith("http")) {
		return false;
	}

	const isReady = async (): Promise<boolean> => {
		const tabs = await listUwaTabs(baseUrl);
		return tabs.some((t) => tabMatchesConversation(t.url, targetUrl));
	};

	if (await isReady()) {
		return true;
	}

	// 尝试打开：sidecar 会在其受控浏览器（同一用户目录）新开标签并激活。
	// profile 优先用标签池直接暴露的 browser_context_id（确定性标识，不经
	// chrome://version 探测页）；拿不到时才回退 name=default（仅覆盖老环境）。
	try {
		const tabs = await listUwaTabs(baseUrl);
		const ctxId = tabs.find((t) => t.browserContextId)?.browserContextId;
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 6_000);
		let res: Response;
		try {
			res = await fetch(`${baseUrl}/api/browser/open-profile-url`, {
				method: "POST",
				signal: ctrl.signal,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					url: targetUrl,
					profile: ctxId
						? { browser_context_id: ctxId }
						: { name: "default" },
				}),
			});
		} finally {
			clearTimeout(timer);
		}
		if (!res.ok) {
			return false;
		}
	} catch {
		return false;
	}

	// 有界轮询等 SPA 加载与标签池收录
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 700));
		if (await isReady()) {
			return true;
		}
	}
	return false;
}
