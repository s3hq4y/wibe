"""incon_bridge 插件钩子。

只覆盖 resolve_history 一个钩子：截获 history_mode=="ide" 的请求，
其余模式原样委托给 history_mode 插件，保证上游行为零回归。

注意：本插件不修改 app/core/ 下任何文件。uwa 有 updater.py /
update_preserve.py 上游同步机制，改核心会导致升级冲突。
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from .ide_mode import resolve_ide_mode

logger = logging.getLogger("uwa.incon_bridge")

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
    return None


def register(host) -> None:
    host.register("resolve_history", resolve_history)
    host.register("on_workflow_end", on_workflow_end)
    logger.info("[incon_bridge] 已注册 2 个钩子 (ide 模式)")
