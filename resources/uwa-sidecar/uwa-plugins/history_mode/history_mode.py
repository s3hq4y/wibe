"""
app/utils/history_mode.py - 多轮对话历史模式处理与指纹对齐

提供与 API 项目一致的多轮对话历史裁剪、尾部对齐与指纹管理功能：
- auto: 标签页已有同一段对话时只补最新一句（接着网页原有上下文聊）；对不上时整段重放
- full: 每次都把完整历史打进输入框（无状态，跨刷新最稳）
- last: 永远只发最后一句（最省，由调用方或网页侧自持上下文）
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
from urllib.parse import urlsplit


def normalize_history_mode(mode: Any, default: str = "auto") -> str:
    """归一化 history_mode 参数，支持 auto, full, last (大小写不敏感)"""
    if isinstance(mode, str):
        cleaned = mode.strip().lower()
        if cleaned in {"auto", "full", "ide", "last"}:
            return cleaned
    return default


def conversation_id(url: str) -> str:
    """提取 URL 中的路径部分作为会话 ID（根路径为空字符串）。

    SPA 站点在首轮回复开始后常将 / 重写为 /c/<id>，
    记录侧初始为空串表示尚未获得会话专属路径，不视为会话跳转。
    """
    raw = str(url or "").strip()
    if not raw:
        return ""
    try:
        path = urlsplit(raw).path
    except ValueError:
        return raw
    return path.rstrip("/")


def get_history_turns(
    messages: Sequence[Dict[str, Any]],
    extract_text_fn: Optional[Callable[[Any], str]] = None,
) -> List[int]:
    """获取所有需要由用户/系统/工具端输入的轮次索引（非 assistant 且内容非空）。"""
    turns: List[int] = []
    extract_fn = extract_text_fn or _extract_message_text_with_attachments
    for idx, msg in enumerate(messages):
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role", "user") or "user").strip().lower()
        if role not in ("user", "system", "tool", "function"):
            continue
        content = msg.get("content", "")
        text = extract_fn(content)
        if text and text.strip():
            turns.append(idx)
    return turns


def _extract_message_text_with_attachments(content: Any) -> str:
    """提取消息文本，并对图片/文件等附件生成唯一摘要指纹。"""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, (int, float, bool)):
        return str(content)
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                t = item.get("type", "")
                if t == "text" or "text" in item:
                    parts.append(str(item.get("text", "") or ""))
                elif t in ("image_url", "image"):
                    url = item.get("image_url", {})
                    if isinstance(url, dict):
                        url = url.get("url", "")
                    elif not isinstance(url, str):
                        url = str(url)
                    if url:
                        h = hashlib.sha1(url.encode('utf-8')).hexdigest()[:8]
                        parts.append(f"[image:{h}]")
                    else:
                        parts.append("[image]")
                elif t == "file" or t == "file_url":
                    file_data = item.get("file_data", {}) or item.get("file", {})
                    if isinstance(file_data, dict):
                        filename = file_data.get("name", "") or file_data.get("filename", "")
                    else:
                        filename = str(file_data)
                    if filename:
                        parts.append(f"[file:{filename}]")
                    else:
                        parts.append("[file]")
                elif t in ("audio", "video"):
                    parts.append(f"[{t}]")
                else:
                    parts.append(str(item))
            elif isinstance(item, str):
                parts.append(item)
        return " ".join(parts).strip()
    if isinstance(content, dict):
        if "text" in content:
            return str(content.get("text", "") or "")
        if "image_url" in content:
            url = content.get("image_url", "")
            h = hashlib.sha1(url.encode('utf-8')).hexdigest()[:8]
            return f"[image:{h}]"
        if "file" in content:
            f = content.get("file", "")
            return f"[file:{f}]"
        try:
            return json.dumps(content, ensure_ascii=False)
        except Exception:
            return str(content)
    return str(content)


def get_turn_stamps(
    messages: Sequence[Dict[str, Any]],
    extract_text_fn: Optional[Callable[[Any], str]] = None,
) -> List[Tuple[int, str]]:
    """计算每一轮输入消息的指纹：(message_index, sha1(role: text)[:16])。"""
    extract_fn = extract_text_fn or _extract_message_text_with_attachments
    turns = get_history_turns(messages, extract_fn)
    out: List[Tuple[int, str]] = []
    for idx in turns:
        msg = messages[idx]
        role = str(msg.get("role", "user") or "user").strip().lower()
        content = msg.get("content", "")
        text = extract_fn(content)
        # 针对 tool 角色附加 name / tool_call_id 元数据
        meta_parts = []
        if role in ("tool", "function"):
            name = str(msg.get("name") or "").strip()
            call_id = str(msg.get("tool_call_id") or msg.get("id") or "").strip()
            if name:
                meta_parts.append(f"name={name}")
            if call_id:
                meta_parts.append(f"id={call_id}")
        meta_str = f"[{','.join(meta_parts)}]" if meta_parts else ""
        blob = f"{role}{meta_str}: {text}"
        digest = hashlib.sha1(blob.encode("utf-8", "replace")).hexdigest()[:16]
        out.append((idx, digest))
    return out


def get_conversation_key(
    messages: Sequence[Dict[str, Any]],
    upto_index: int,
    extract_text_fn: Optional[Callable[[Any], str]] = None,
) -> str:
    """计算截止到 upto_index 前的完整历史指纹（覆盖 assistant 回复以防篡改）。"""
    extract_fn = extract_text_fn or _extract_message_text_with_attachments
    parts: List[str] = []
    for msg in messages[:upto_index]:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role", "user") or "user").strip().lower()
        content = msg.get("content", "")
        text = extract_fn(content)
        # assistant tool_calls 补充到指纹中
        if role == "assistant":
            tool_calls = msg.get("tool_calls") or msg.get("function_call")
            if tool_calls:
                try:
                    tc_str = json.dumps(tool_calls, sort_keys=True, ensure_ascii=False)
                except Exception:
                    tc_str = str(tool_calls)
                text = f"{text}\n{tc_str}".strip() if text else tc_str
        if text:
            parts.append(f"{role}: {text}")
    blob = "\n\n".join(parts)
    return hashlib.sha1(blob.encode("utf-8", "replace")).hexdigest()[:16]


def align_tail(remembered_turn_keys: Sequence[str], seq_stamps: Sequence[str]) -> Optional[int]:
    """计算客户端新送来的消息序列 seq_stamps 开头与标签页已记录历史尾部的对齐轮数。

    - 比较方式：以新序列开头 seq_stamps[:matched] 去匹配已记忆序列尾部 remembered[N-matched:]
    - 允许客户端滑窗（丢弃最老的几条），只要保留的序列与已输入内容连续一致即判定对齐。
    - 返回 matched（对齐命中的轮次数），返回 None 表示无法对齐。
    """
    total = len(seq_stamps)
    remembered_len = len(remembered_turn_keys)
    if not remembered_len or total < 2:
        return None
    for matched in range(min(remembered_len, total - 1), 0, -1):
        if list(seq_stamps[:matched]) == list(remembered_turn_keys[remembered_len - matched:]):
            return matched
    return None


@dataclass
class HistoryResolution:
    """多轮历史解析决策结果"""
    mode: str
    prompt_text: str
    typed_messages: List[Dict[str, Any]]
    skip_new_chat: bool
    is_continuation: bool
    turn: int
    typed_chars: int
    full_chars: int
    new_conversation_key: Optional[str]
    new_turn_keys: Tuple[str, ...]
    reason: str


def resolve_history_turns(
    session: Any,
    messages: List[Dict[str, Any]],
    history_mode: Optional[str] = None,
    live_url: str = "",
    extract_text_fn: Optional[Callable[[Any], str]] = None,
    build_prompt_fn: Optional[Callable[[List[Dict[str, Any]]], str]] = None,
) -> HistoryResolution:
    """根据 session 状态、messages 和 history_mode 计算本次向网页发送的内容与是否新建对话。

    参数：
    - session: TabSession 实例（需具备 turns, conversation_len, conversation_key, turn_keys 等属性）
    - messages: 原始消息列表
    - history_mode: 请求或配置指定的 history_mode（"auto", "full", "last"）
    - live_url: 当前标签页 URL
    - extract_text_fn: 消息内容文本提取函数
    - build_prompt_fn: 组装 prompt 的函数
    """
    extract_fn = extract_text_fn or _extract_message_text_with_attachments

    def _default_build_prompt(msgs: List[Dict[str, Any]]) -> str:
        parts = []
        for m in msgs:
            if not isinstance(m, dict):
                continue
            r = str(m.get("role", "user") or "user").strip().lower()
            if r in ("tool", "function"):
                r = "user"
            t = extract_fn(m.get("content", ""))
            if t:
                parts.append(f"{r}: {t}")
        return "\n\n".join(parts)

    build_fn = build_prompt_fn or _default_build_prompt
    mode = normalize_history_mode(history_mode, default="auto")

    full_prompt = build_fn(messages)
    full_chars = len(full_prompt)
    turns = get_history_turns(messages, extract_fn)

    # full 模式或没有有效轮次：全量重放
    if mode == "full" or not turns:
        return HistoryResolution(
            mode="full",
            prompt_text=full_prompt,
            typed_messages=list(messages),
            skip_new_chat=False,
            is_continuation=False,
            turn=1,
            typed_chars=full_chars,
            full_chars=full_chars,
            new_conversation_key=None,  # full 模式不记录指纹，保持无状态
            new_turn_keys=(),
            reason="full_mode" if mode == "full" else "no_history_turns",
        )

    # last 模式：永远只发最后一句
    if mode == "last":
        last_turn_idx = turns[-1]
        tail = list(messages[last_turn_idx:])
        prompt_text = build_fn(tail)
        session_turns = getattr(session, "turns", 0) or 0
        is_cont = session_turns > 0
        current_turn = session_turns + 1 if is_cont else 1
        stamps = get_turn_stamps(messages, extract_fn)
        new_key = get_conversation_key(messages, len(messages), extract_fn)
        return HistoryResolution(
            mode="last",
            prompt_text=prompt_text,
            typed_messages=tail,
            skip_new_chat=is_cont,  # 若已有会话则跳过新建对话
            is_continuation=is_cont,
            turn=current_turn,
            typed_chars=len(prompt_text),
            full_chars=full_chars,
            new_conversation_key=new_key,
            new_turn_keys=tuple(d for _, d in stamps),
            reason="last_mode_continuation" if is_cont else "last_mode_first_turn",
        )

    # auto 模式：检查标签页是否持有当前对话前缀
    held = getattr(session, "conversation_len", 0) or 0
    session_turns = getattr(session, "turns", 0) or 0
    session_conv_id = getattr(session, "conversation_id", "") or ""
    session_conv_key = getattr(session, "conversation_key", "") or ""
    session_turn_keys = getattr(session, "turn_keys", ()) or ()

    live_conv_id = conversation_id(live_url)
    # 会话 ID 变化（如从 /c/A 变成 /c/B）表示用户在标签页内切换了其他会话
    moved = bool(session_conv_id) and bool(live_conv_id) and live_conv_id != session_conv_id

    stamps = get_turn_stamps(messages, extract_fn)
    aligned = align_tail(session_turn_keys, [d for _, d in stamps])
    key_ok = bool(
        session_conv_key
        and 0 < held <= len(messages)
        and get_conversation_key(messages, held, extract_fn) == session_conv_key
    )

    cut: Optional[int] = None
    if aligned is not None and aligned < len(stamps):
        cut = stamps[aligned][0]
    elif key_ok and 0 < held < len(messages):
        cut = held

    usable = bool(
        session_turns > 0
        and not moved
        and cut is not None
        and 0 < cut < len(messages)
    )

    if usable and cut is not None:
        tail = list(messages[cut:])
        prompt_text = build_fn(tail)
        # 若裁剪后文本为空（例如只有 assistant 消息），退化为全量
        if prompt_text.strip():
            new_key = get_conversation_key(messages, len(messages), extract_fn)
            return HistoryResolution(
                mode="auto",
                prompt_text=prompt_text,
                typed_messages=tail,
                skip_new_chat=True,
                is_continuation=True,
                turn=session_turns + 1,
                typed_chars=len(prompt_text),
                full_chars=full_chars,
                new_conversation_key=new_key,
                new_turn_keys=tuple(d for _, d in stamps),
                reason=f"aligned_{aligned}" if aligned is not None else "prefix_match",
            )

    # 不可用：全量重放并重置标签页会话
    reason = (
        "tab_moved"
        if moved
        else (
            "rewrote_history"
            if session_turns > 0 and len(messages) <= held
            else ("mismatch" if session_turns > 0 else "first_turn")
        )
    )
    new_key = get_conversation_key(messages, len(messages), extract_fn)
    return HistoryResolution(
        mode="auto",
        prompt_text=full_prompt,
        typed_messages=list(messages),
        skip_new_chat=False,
        is_continuation=False,
        turn=1,
        typed_chars=full_chars,
        full_chars=full_chars,
        new_conversation_key=new_key,
        new_turn_keys=tuple(d for _, d in stamps),
        reason=reason,
    )
