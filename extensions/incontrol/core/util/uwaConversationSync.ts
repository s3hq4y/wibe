import { createHash } from "crypto";
import { uwaTrace } from "./uwaRequestContext.js";

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
		uwaTrace(
			`listTabs n=${raw.length} ${raw
				.slice(0, 6)
				.map((t: any) => String(t?.url ?? ""))
				.join(" | ")}`,
		);
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
 * URL 规范化 + 路由 token 的本地复刻。
 *
 * sidecar 的 /tab-url/{token} 路由按标签页当前 URL 现场比对：
 *   token = sha1(normalize_exact_tab_url(url))[:12]
 * （见 app/utils/site_url.py 与 app/core/tab_pool_parts/manager.py），
 * 因此 token 不需要 /api/tab-pool/tabs 条目预置（该端点条目的
 * url_route_token 字段并不总是存在）——由会话 URL 本地编码即可得到
 * 与 sidecar 一致的确定性路由键。
 */
export function encodeTabUrlRouteToken(value: string): string {
	const raw = String(value ?? "").trim();
	if (!raw) {
		return "";
	}
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return "";
	}
	const scheme = u.protocol.replace(/:$/, "").toLowerCase();
	const hostname = u.hostname.toLowerCase().replace(/\.$/, "");
	if (!scheme || !hostname) {
		return "";
	}
	const defaultPort = scheme === "http" ? 80 : scheme === "https" ? 443 : undefined;
	let host = hostname.includes(":") ? `[${hostname}]` : hostname;
	if (u.port && u.port !== String(defaultPort ?? "")) {
		host = `${host}:${u.port}`;
	}
	const path = u.pathname || "/";
	const normalized = `${scheme}://${host}${path}${u.search}${u.hash}`;
	return createHash("sha1").update(normalized).digest("hex").slice(0, 12);
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
	uwaTrace(`prepare base=${baseUrl} target=${targetUrl}`);
	if (!targetUrl?.startsWith("http")) {
		uwaTrace(`prepare -> null (target not http)`);
		return null;
	}

	// /tab-url/{token} 的 token 是目标 URL 的确定性哈希（sha1(normalize(url))[:12]），
	// 由本地直接编码即可，不再依赖 /api/tab-pool/tabs 条目里可能缺失的
	// url_route_token 字段——该字段缺失是此前“定向从未生效、消息静默走默认
	// 端点、续聊/工具回灌落到最新活动标签页”的原因。
	const token = encodeTabUrlRouteToken(targetUrl);
	if (!token) {
		uwaTrace(`prepare -> null (token empty)`);
		return null;
	}
	const routeUrl = `${baseUrl.replace(/\/$/, "")}/tab-url/${token}/v1/chat/completions`;

	// 就绪判定用“严格 token 相等”（与 sidecar _get_tabs_by_url_route_token 的
	// encode(actual_url) 比对一致），避免 tab 停靠 URL 与目标 URL 存在非规范
	// 差异时发出 /tab-url 请求被 sidecar 以 404 拒绝；不中就降级默认端点。
	const isReady = async (): Promise<boolean> => {
		const tabs = await listUwaTabs(baseUrl);
		return tabs.some((t) => encodeTabUrlRouteToken(t.url) === token);
	};

	// 1) 页面已在池中（严格 token 匹配）→ 直接用本地编码的 token 路由
	if (await isReady()) {
		uwaTrace(`prepare -> ${routeUrl} (page ready)`);
		return routeUrl;
	}

	// 2) 页面不在：先导航回 targetUrl（新标签并激活），SPA 收录后重查
	const ensured = await ensureConversationPage(baseUrl, targetUrl, timeoutMs);
	uwaTrace(`ensure=${ensured}`);
	if (await isReady()) {
		uwaTrace(`prepare -> ${routeUrl} (after ensure)`);
		return routeUrl;
	}
	uwaTrace(`prepare -> null (fallback default endpoint)`);
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
			uwaTrace(`open-profile-url HTTP ${res.status}`);
			return false;
		}
		uwaTrace(`open-profile-url ok url=${targetUrl}`);
	} catch (e) {
		uwaTrace(`open-profile-url ERR ${String(e)}`);
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
