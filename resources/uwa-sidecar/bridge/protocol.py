"""IDE <-> uwa-sidecar 桥接协议 (Python 侧)。

与 extensions/incontrol/bridge/protocol.ts 是同一份契约的两种语言表达。
修改任一侧都必须同步另一侧，并同时更新 PROTOCOL_VERSION。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Literal, Optional

PROTOCOL_VERSION = 2

DEFAULT_SIDECAR_PORT = 8199

# ---------------------------------------------------------------- 类型别名
HistoryMode = Literal["auto", "full", "last", "ide"]
NewConversationReason = Literal["compaction", "model_switch", "manual"]
SystemPromptMode = Literal["inject_once", "always", "never"]
SessionBindingState = Literal["IDLE", "BOUND", "MIGRATING", "DESYNCED"]

#: 本项目新增的历史模式。行为类似 last（只发最后一句），
#: 但「是否新建对话」由 IDE 显式命令，而非依据 session.turns 推断。
IDE_MODE: HistoryMode = "ide"

#: 归一化时允许的全部模式，供插件覆盖 normalize_history_mode 使用
ALLOWED_HISTORY_MODES = frozenset({"auto", "full", "last", "ide"})

#: 响应里承载桥接信息的字段名
RESPONSE_EXTENSION_KEY = "x_uwa"


# ---------------------------------------------------------------- 请求侧
@dataclass
class ConversationHint:
    """开新对话的动机说明，便于日志追踪与失败回滚。"""

    reason: NewConversationReason
    prev_conversation_url: str = ""

    @classmethod
    def from_dict(cls, d: Optional[Dict[str, Any]]) -> Optional["ConversationHint"]:
        if not isinstance(d, dict):
            return None
        reason = str(d.get("reason", "manual") or "manual")
        if reason not in ("compaction", "model_switch", "manual"):
            reason = "manual"
        return cls(
            reason=reason,  # type: ignore[arg-type]
            prev_conversation_url=str(d.get("prev_conversation_url", "") or ""),
        )


@dataclass
class UwaRequestExtension:
    """挂在 OpenAI 请求体根节点的桥接扩展字段。"""

    history_mode: Optional[HistoryMode] = None
    force_new_conversation: bool = False
    system_prompt_mode: SystemPromptMode = "inject_once"
    conversation_hint: Optional[ConversationHint] = None
    #: IDE 侧会话槽已绑定某网页对话时，续聊请求携带该对话 URL。插件据此
    #: 把「只有 system+1 条 user（如压缩迁移后的首条消息）」的请求判为续聊
    #: 而非新会话首轮，避免迁移后误点新建。
    resume_conversation_url: str = ""

    @classmethod
    def from_payload(cls, payload: Dict[str, Any]) -> "UwaRequestExtension":
        """从请求体里抽取桥接字段；缺失时回退到安全默认值。"""
        mode = payload.get("history_mode")
        if isinstance(mode, str):
            cleaned = mode.strip().lower()
            mode = cleaned if cleaned in ALLOWED_HISTORY_MODES else None
        else:
            mode = None

        spm = str(payload.get("system_prompt_mode", "inject_once") or "inject_once")
        if spm not in ("inject_once", "always", "never"):
            spm = "inject_once"

        return cls(
            history_mode=mode,  # type: ignore[arg-type]
            force_new_conversation=bool(payload.get("force_new_conversation", False)),
            system_prompt_mode=spm,  # type: ignore[arg-type]
            conversation_hint=ConversationHint.from_dict(
                payload.get("conversation_hint")
            ),
            resume_conversation_url=str(
                payload.get("resume_conversation_url", "") or ""
            ).strip(),
        )


# ---------------------------------------------------------------- 响应侧
@dataclass
class UwaResponseExtension:
    """回传给 IDE 的会话状态，序列化后挂在响应根节点 x_uwa。"""

    conversation_url: str = ""
    conversation_id: str = ""
    tab_index: int = -1
    turn: int = 0
    history_mode: HistoryMode = "auto"
    typed_chars: int = 0
    full_chars: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "conversation_url": self.conversation_url,
            "conversation_id": self.conversation_id,
            "tab_index": self.tab_index,
            "turn": self.turn,
            "history_mode": self.history_mode,
            "typed_chars": self.typed_chars,
            "full_chars": self.full_chars,
        }

    @classmethod
    def from_session(
        cls,
        session: Any,
        resolution: Any = None,
        tab_index: int = -1,
    ) -> "UwaResponseExtension":
        """从 TabSession（及可选的 HistoryResolution）提取回传信息。

        session 侧字段在 app/core/tab_pool_parts/session.py 中已存在：
        conversation_url / conversation_id / turns / history_mode
        """
        return cls(
            conversation_url=str(getattr(session, "conversation_url", "") or ""),
            conversation_id=str(getattr(session, "conversation_id", "") or ""),
            tab_index=int(tab_index),
            turn=int(getattr(session, "turns", 0) or 0),
            history_mode=str(
                getattr(resolution, "mode", None)
                or getattr(session, "history_mode", None)
                or "auto"
            ),  # type: ignore[arg-type]
            typed_chars=int(getattr(resolution, "typed_chars", 0) or 0),
            full_chars=int(getattr(resolution, "full_chars", 0) or 0),
        )


def attach_response_extension(
    body: Dict[str, Any], ext: UwaResponseExtension
) -> Dict[str, Any]:
    """把桥接字段挂到响应体上（非侵入：不改动任何 OpenAI 标准字段）。"""
    if isinstance(body, dict):
        body[RESPONSE_EXTENSION_KEY] = ext.to_dict()
    return body
