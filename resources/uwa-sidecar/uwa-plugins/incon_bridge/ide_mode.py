"""ide 历史模式实现。

与上游 last 模式的关键差异
--------------------------
last 模式下 ``skip_new_chat`` 是**推断**出来的::

    is_cont = session.turns > 0
    skip_new_chat = is_cont

这对纯 API 调用够用，但 IDE 场景下不行：压缩对话、切换模型时，
IDE 需要**主动命令** uwa 开一个新对话，把系统提示词 + 压缩摘要
重新打进去。这是控制反转，必须显式化。

ide 模式把这个决定权交还给调用方::

    force_new_conversation=True  -> 必定开新对话（忽略历史推断）
    force_new_conversation=False -> 由本次请求自行判断续聊：请求自带
                                    assistant 回复或 ≥2 轮 user 才算续聊；
                                    否则视为新 IDE 会话的首轮、开新对话。
                                    不能沿用标签页上累积的 session.turns——
                                    同一标签页跨多个 IDE 会话复用，旧会话的
                                    计数会把“新会话第一条消息”误判成续聊。

系统提示词处理
--------------
``system_prompt_mode="inject_once"`` 时，只有新建对话的首轮会把 system
消息一并打进输入框；续聊轮次会跳过 system，避免每轮重复发送浪费上下文。
"""
from __future__ import annotations

import logging
import sys
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("uwa.incon_bridge")

_HM_CACHE: Any = None


def _load_history_mode():
    """复用 history_mode 插件的工具函数（轮次指纹、HistoryResolution 等）。

    插件目录名 history_mode 不是合法的顶层包路径，因此用 importlib
    按文件路径加载，避免依赖 sys.path 布局。
    """
    global _HM_CACHE
    if _HM_CACHE is not None:
        return _HM_CACHE

    # 优先走正常包导入（插件被 loader 以包形式加载时可用）
    try:
        from uwa_plugins.history_mode import history_mode as hm  # type: ignore

        _HM_CACHE = hm
        return hm
    except Exception:
        pass

    import importlib.util
    from pathlib import Path

    target = (
        Path(__file__).resolve().parent.parent / "history_mode" / "history_mode.py"
    )
    mod_name = "_uwa_history_mode"
    spec = importlib.util.spec_from_file_location(mod_name, target)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load history_mode from {target}")
    module = importlib.util.module_from_spec(spec)
    # 必须先登记再 exec：@dataclass 会通过 sys.modules[cls.__module__]
    # 反查命名空间，未登记时 Python 3.12+ 会抛 AttributeError。
    sys.modules[mod_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(mod_name, None)
        raise
    _HM_CACHE = module
    return module


def _split_system(messages: List[Dict[str, Any]]):
    """拆出 system 消息与其余消息。"""
    system_msgs: List[Dict[str, Any]] = []
    rest: List[Dict[str, Any]] = []
    for m in messages:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role", "user") or "user").strip().lower()
        (system_msgs if role == "system" else rest).append(m)
    return system_msgs, rest


def resolve_ide_mode(
    session: Any,
    messages: List[Dict[str, Any]],
    *,
    force_new_conversation: bool = False,
    system_prompt_mode: str = "inject_once",
    extract_text_fn: Optional[Callable[[Any], str]] = None,
    build_prompt_fn: Optional[Callable[[List[Dict[str, Any]]], str]] = None,
):
    """构造 ide 模式的 HistoryResolution。

    复用 history_mode 插件的既有工具函数，避免重复实现轮次指纹逻辑。
    """
    hm = _load_history_mode()

    extract_fn = extract_text_fn or hm._extract_message_text_with_attachments
    build_fn = build_prompt_fn or (
        lambda msgs: "\n\n".join(
            f"{str(m.get('role', 'user') or 'user').strip().lower()}: {extract_fn(m.get('content', ''))}"
            for m in msgs
            if isinstance(m, dict) and extract_fn(m.get("content", ""))
        )
    )

    full_prompt = build_fn(messages)
    full_chars = len(full_prompt)
    turns = hm.get_history_turns(messages, extract_fn)

    session_turns = int(getattr(session, "turns", 0) or 0)

    # 是否续聊：显式命令优先于状态推断。
    #
    # 续聊不能由 session_turns > 0 推断：sidecar 的 session 按浏览器标签页
    # 长期复用，上一场对话跑完后 session_turns 不会归零；此时 IDE 新开一个
    # 会话并发首条消息（请求体只有 system + 第一条 user，无任何 assistant
    # 历史），仍会被误判成旧对话的续聊、打进旧网页对话。因此由“本次请求
    # 自身携带的历史”决定：
    #   - 请求含 assistant 回复 → 确属既有对话的续聊；
    #   - 否则（仅 system + 首条 user）→ 新 IDE 会话的首轮 → 开新对话。
    # 注意不能把 system/tool 算成“轮”：get_history_turns 把所有非 assistant
    # 消息都算进去，新会话请求也有 2 条（system+user）。
    if force_new_conversation:
        is_cont = False
        reason = "ide_mode_forced_new"
    else:
        user_turn_count = sum(
            1
            for m in messages
            if isinstance(m, dict)
            and str(m.get("role", "") or "").strip().lower() == "user"
        )
        has_assistant = any(
            isinstance(m, dict)
            and str(m.get("role", "") or "").strip().lower() == "assistant"
            for m in messages
        )
        is_cont = has_assistant or user_turn_count >= 2
        reason = "ide_mode_continuation" if is_cont else "ide_mode_first_turn"

    if not turns:
        # 没有有效轮次，退化为全量
        typed = list(messages)
        prompt_text = full_prompt
    else:
        last_turn_idx = turns[-1]
        tail = list(messages[last_turn_idx:])

        if is_cont:
            # 续聊：只发最后一句；inject_once 下丢弃 system
            if system_prompt_mode == "inject_once":
                _, tail = _split_system(tail)
            typed = tail
        else:
            # 新对话首轮：system 必须随行，否则网页侧没有人格设定
            system_msgs, _ = _split_system(messages)
            if system_prompt_mode == "never":
                system_msgs = []
            typed = system_msgs + tail

        prompt_text = build_fn(typed)

    stamps = hm.get_turn_stamps(messages, extract_fn)
    new_key = hm.get_conversation_key(messages, len(messages), extract_fn)

    return hm.HistoryResolution(
        mode="ide",
        prompt_text=prompt_text,
        typed_messages=typed,
        skip_new_chat=is_cont,
        is_continuation=is_cont,
        turn=(session_turns + 1) if is_cont else 1,
        typed_chars=len(prompt_text),
        full_chars=full_chars,
        new_conversation_key=new_key,
        new_turn_keys=tuple(d for _, d in stamps),
        reason=reason,
    )
