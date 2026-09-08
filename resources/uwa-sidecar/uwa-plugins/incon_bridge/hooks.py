"""incon_bridge 插件钩子。

只覆盖 resolve_history 一个钩子：截获 history_mode=="ide" 的请求，
其余模式原样委托给 history_mode 插件，保证上游行为零回归。

注意：本插件不修改 app/core/ 下任何文件。uwa 有 updater.py /
update_preserve.py 上游同步机制，改核心会导致升级冲突。
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

logger = logging.getLogger("uwa.incon_bridge")

#: 最近一次 ide 请求成功收尾后的会话信息（供 API 中间件注入 x_uwa）。
#: 模块级而非 contextvar：on_workflow_end 可能在异步子任务里执行，
#: contextvar 跨任务不共享；ide 场景为单请求串行，可接受。
_LAST_XUWA: Optional[dict] = None


def get_last_xuwa() -> Optional[dict]:
    return _LAST_XUWA


from .ide_mode import resolve_ide_mode

#: 由 API 层在处理请求时写入，供钩子读取本轮的桥接参数。
#: 使用 contextvars 以支持并发请求隔离。
try:
    from contextvars import ContextVar

    _current_ext: "ContextVar[Optional[Any]]" = ContextVar(
        "incon_bridge_request_ext", default=None
    )
except Exception:  # pragma: no cover
    _current_ext = None  # type: ignore


def set_request_extension(ext: Any) -> None:
    """由 API 层调用，登记本次请求的桥接扩展字段。"""
    if _current_ext is not None:
        _current_ext.set(ext)


def get_request_extension() -> Optional[Any]:
    if _current_ext is not None:
        return _current_ext.get()
    return None


def _delegate_to_history_mode(session, messages, history_mode, live_url,
                              extract_text_fn, build_prompt_fn):
    """非 ide 模式：交回 history_mode 插件原逻辑。"""
    try:
        from uwa_plugins.history_mode import hooks as hm_hooks  # type: ignore

        return hm_hooks.resolve_history(
            session=session,
            messages=messages,
            history_mode=history_mode,
            live_url=live_url,
            extract_text_fn=extract_text_fn,
            build_prompt_fn=build_prompt_fn,
        )
    except Exception:
        # history_mode 插件不可用时返回 None，宿主会走上游原始逻辑
        return None


def resolve_history(session, messages, history_mode, live_url,
                    extract_text_fn=None, build_prompt_fn=None):
    """resolve_history 钩子：ide 模式走本插件，其余委托。"""
    mode = str(history_mode or "").strip().lower()
    if not mode:
        # 请求体缺 history_mode（扩展侧偶发未注入）时，回退扩展 spawn 时
        # 注入的环境变量，保证 IDE 会话仍按 ide 模式处理（续聊不新建）。
        try:
            import os
            env_mode = str(os.environ.get("HISTORY_MODE", "") or "").strip().lower()
            if env_mode == "ide":
                mode = env_mode
                logger.info("[incon_bridge] history_mode missing, fell back to env HISTORY_MODE=%s", mode)
        except Exception:
            pass

    if mode != "ide":
        return _delegate_to_history_mode(
            session, messages, history_mode, live_url,
            extract_text_fn, build_prompt_fn,
        )

    ext = get_request_extension()
    force_new = bool(getattr(ext, "force_new_conversation", False))
    spm = str(getattr(ext, "system_prompt_mode", "inject_once") or "inject_once")

    resolution = resolve_ide_mode(
        session=session,
        messages=messages,
        force_new_conversation=force_new,
        system_prompt_mode=spm,
        extract_text_fn=extract_text_fn,
        build_prompt_fn=build_prompt_fn,
    )

    hint = getattr(ext, "conversation_hint", None)
    logger.info(
        "[incon_bridge] ide mode: turn=%s cont=%s typed=%s/%s reason=%s%s",
        resolution.turn,
        resolution.is_continuation,
        resolution.typed_chars,
        resolution.full_chars,
        resolution.reason,
        f" trigger={hint.reason}" if hint is not None else "",
    )
    return resolution


def _await_new_conversation_url(tab, start_url, domain, timeout=12.0):
    """首轮开新对话后，SPA 的 URL 常滞后数秒才切换到真实会话地址。

    若在切换前按当前 URL 记录，会记成根路径或旧会话 URL，导致 IDE 存下的
    conversation_url 不是真正的网页会话。这里做有界轮询（仅用于非续聊轮）：
      - start 不是会话地址（如 '/'）：等到 URL 出现会话段（deepseek: /a/chat/）；
      - start 已是会话地址（旧会话页上开新对话）：等到 URL 换成另一个会话地址；
      - 超时未切换：返回最后一次读到的 URL（会话确实没换页时也正确）。
    """
    start = (start_url or "").strip()
    dom = (domain or "").lower()
    if "deepseek.com" in dom:
        needle = "/a/chat/"
    else:
        needle = None  # 未知站点：任意离开起点的导航都视为进入新会话

    cur = start
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(0.5)
        try:
            cur = str(getattr(tab, "url", "") or "").strip()
        except Exception:
            cur = ""
        if not cur or cur == start:
            continue
        if needle is None:
            return cur
        if needle in cur:
            return cur
    return cur or start


def on_workflow_end(session, tab, resolution, messages, prompt_text,
                    domain, preset_name, aborted=False, stop_requested=False):
    """ide 模式收尾：记录会话指纹与 URL，供下一轮续聊与 IDE 回读。

    history_mode 插件的同名钩子只处理 auto/last，会因 mode 不匹配而跳过
    ide 模式，所以这里必须补上，否则 conversation_url 不会被写入 session。
    """
    if aborted or stop_requested or resolution is None:
        return None
    if getattr(resolution, "mode", "") != "ide":
        return None
    if not resolution.new_conversation_key:
        return None

    url = str(
        getattr(session, "last_known_url", "") or getattr(tab, "url", "") or ""
    ).strip()

    # 非续聊轮（首轮/强制新对话）才需要等 SPA 切 URL；续聊轮直接沿用
    # 当前会话地址，不引入额外延迟。
    is_continuation = bool(getattr(resolution, "is_continuation", True))
    is_forced_new = str(getattr(resolution, "reason", "")) == "ide_mode_forced_new"
    if not is_continuation and not is_forced_new:
        url = _await_new_conversation_url(tab, url, domain)

    session.remember_turn(
        key=resolution.new_conversation_key,
        length=len(messages),
        url=url,
        typed=prompt_text,
        turn_keys=resolution.new_turn_keys,
        history_mode=resolution.mode,
    )
    session.mark_conversation_activity(domain=domain, preset_name=preset_name)
    logger.info("[incon_bridge] bound conversation_url=%s turn=%s", url, session.turns)

    # 供 API 中间件注入 x_uwa：让扩展在响应（含 SSE 末帧）里拿到本次
    # 会话 URL / 轮次，从而把「网页对话」绑定到 IDE 会话。
    try:
        from urllib.parse import urlsplit

        tab_index = getattr(session, "index", None)
        if tab_index is None:
            tab_index = getattr(session, "persistent_index", None)
        if tab_index is None:
            for attr in ("persistent_index", "index", "pool_index", "position"):
                v = getattr(tab, attr, None)
                if v is not None:
                    tab_index = v
                    break
        global _LAST_XUWA
        _LAST_XUWA = {
            "conversation_url": url,
            "conversation_id": urlsplit(url).path if url else "",
            "tab_index": int(tab_index) if tab_index is not None else -1,
            "turn": int(getattr(session, "turns", 0) or 0),
            "history_mode": "ide",
        }
    except Exception:
        _LAST_XUWA = None
    return None


def register(host) -> None:
    host.register("resolve_history", resolve_history)
    host.register("on_workflow_end", on_workflow_end)

    # 安装 API 层接线（请求字段解析 + 响应 x_uwa 回传）。
    # 失败只降级不报错：uwa 仍可作为普通 OpenAI 网关使用。
    try:
        from .api_patch import install

        if install():
            logger.info("[incon_bridge] API 接线已安装")
        else:
            logger.warning("[incon_bridge] API 接线未完全安装，x_uwa 可能缺失")
    except Exception as exc:
        logger.warning("[incon_bridge] API 接线失败: %s", exc)

    logger.info("[incon_bridge] 已注册 2 个钩子 (ide 模式)")
