"""history_mode 插件的钩子实现。

把原 fork 中对上游核心循环的改动，收敛为 6 个钩子（全部有默认值，无插件可运行）：

  compute_turn_hint    —— 计算"轮次指纹"提示，用于标签页亲和
  resolve_history      —— 决定 skip_new_chat 与本次要输入的内容（核心）
  step_should_skip     —— 按 skip_on_continuation / skip_when_not_full 标记跳过步骤
  find_affinity_session—— 在候选标签页中按指纹命中上次对话所在标签页
  on_workflow_end      —— 成功收尾时记录会话指纹
  on_workflow_finally  —— 中止/停止时清空会话记忆
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from . import history_mode as hm

logger = logging.getLogger("uwa.history_mode")


def _effective_mode(history_mode: Optional[str]) -> str:
    """取请求参数 -> 环境/配置 -> 默认 auto 的有效模式。"""
    mode = history_mode
    if not mode:
        try:
            from app.core.config_parts.browser_constants import BrowserConstants
            mode = BrowserConstants.get("HISTORY_MODE")
        except Exception:
            mode = None
    return hm.normalize_history_mode(mode, default="auto")


# ---------------------------------------------------------------- 钩子 1
def compute_turn_hint(messages, extract_text_fn=None):
    """返回本轮请求的轮次指纹序列（用于标签页亲和）。"""
    return tuple(d for _, d in hm.get_turn_stamps(messages, extract_text_fn))


# ---------------------------------------------------------------- 钩子 2（核心）
def resolve_history(session, messages, history_mode, live_url,
                    extract_text_fn=None, build_prompt_fn=None):
    """返回 HistoryResolution；宿主据此决定 skip_new_chat、prompt_text 等。"""
    mode = _effective_mode(history_mode)
    return hm.resolve_history_turns(
        session=session,
        messages=messages,
        history_mode=mode,
        live_url=live_url or "",
        extract_text_fn=extract_text_fn,
        build_prompt_fn=build_prompt_fn,
    )


# ---------------------------------------------------------------- 钩子 3
def step_should_skip(step, action_upper, target_key, is_continuation,
                     session=None, history_mode="full"):
    """决定是否跳过某工作流步骤（两套标记语义）：

    - skip_when_not_full：非 full 模式下永不执行该步骤。用于「会遗忘先前信息」的
      破坏性步骤，如 Gemini 的“临时对话按钮”——点了就开一个不保存历史的临时对话，
      auto/last 模式必须永远不点（包括第一轮）。
    - skip_on_continuation：仅在续聊复用当前对话（is_continuation=True）时跳过。
      续聊时页面停留在原对话，这些按钮/快捷键不再渲染或不应再触发，
      如模型选择下拉、DeepSeek 专家模式切换、Gemini 的 Ctrl+Shift+O 新对话快捷键。
    """
    s = step or {}
    mode = str(history_mode or "full").strip().lower()
    if s.get("skip_when_not_full") and mode != "full":
        return True
    if s.get("skip_on_continuation") and is_continuation:
        return True
    return False


# ---------------------------------------------------------------- 钩子 4
def find_affinity_session(sessions, turn_hint):
    """按 turn_hint 在空闲标签页中命中上次对话所在标签页；找不到返回 None。"""
    if not turn_hint:
        return None
    try:
        from app.core.tab_pool_parts.session import TabStatus
    except Exception:
        return None
    scored = []
    for s in sessions or []:
        if getattr(s, "status", None) == TabStatus.IDLE and getattr(s, "turn_keys", None):
            match = hm.align_tail(list(s.turn_keys), list(turn_hint))
            if match is not None:
                scored.append((match, s))
    if not scored:
        return None
    best = max(m for m, _ in scored)
    for m, s in scored:
        if m == best:
            return s
    return None


# ---------------------------------------------------------------- 钩子 5
def on_workflow_end(session, tab, resolution, messages, prompt_text,
                    domain, preset_name, aborted=False, stop_requested=False):
    """成功收尾时记录会话指纹（供下一轮续聊对齐）。"""
    if aborted or stop_requested or resolution is None:
        return None
    if not resolution.new_conversation_key:
        return None
    if getattr(resolution, "mode", "") not in ("auto", "last"):
        return None
    url = str(getattr(session, "last_known_url", "") or getattr(tab, "url", "") or "").strip()
    session.remember_turn(
        key=resolution.new_conversation_key,
        length=len(messages),
        url=url,
        typed=prompt_text,
        turn_keys=resolution.new_turn_keys,
        history_mode=resolution.mode,
    )
    session.mark_conversation_activity(domain=domain, preset_name=preset_name)
    return None


# ---------------------------------------------------------------- 钩子 6
def on_workflow_finally(session, aborted=False, stop_requested=False, command_interrupted=False):
    """中止或停止时清空会话记忆；命令中断（对话延续）则保留。"""
    if aborted or (stop_requested and not command_interrupted):
        session.forget_conversation()
    return None


def register(host) -> None:
    host.register("compute_turn_hint", compute_turn_hint)
    host.register("resolve_history", resolve_history)
    host.register("step_should_skip", step_should_skip)
    host.register("find_affinity_session", find_affinity_session)
    host.register("on_workflow_end", on_workflow_end)
    host.register("on_workflow_finally", on_workflow_finally)
    logger.info("[history_mode] 已注册 6 个钩子")
