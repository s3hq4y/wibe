# -*- coding: utf-8 -*-
"""en_logs 插件 —— 把控制台与文件日志的中文翻译为中立的英文。

原理：
- 上游 SecureLogger 输出前调用 _cuteify_*_message 计算"展示层文本"，
  控制台 Formatter 优先显示该文本（codex_display_message_text）；
  文件 Formatter 优先显示 codex_original_message_text。
- 本插件：
  1) 替换 secure_logger 的四个 _cuteify_*_message 为英文翻译器；
  2) 包装 SecureLogger._emit，在落日志前先把 msg 翻译为英文，
     于是 codex_original_message_text（文件日志）同样为英文；
  3) 给 root logger 的 handlers 挂 Filter，兜底翻译标准 logging 日志。
- install_early() 用 __import__ 钩子在 secure_logger 首次导入时立即接管，
  使启动初期的 app 初始化日志同样输出英文。

不修改任何上游源码，卸载插件即恢复中文输出。
"""
from __future__ import annotations

import logging
import re
import sys

from .translations_a import T_A
from .translations_b import T_B
from .translations_c import T_C
from .translations_d import T_D
from .translations_e import T_E
from .translations_f import T_F
from .translations_g import T_G
from .translations_h import T_H

logger = logging.getLogger("uwa.en_logs")

# 合并翻译表，键按长度降序（长的先匹配，避免短键破坏长短语）
_TABLE: dict = {}
for _t in (T_A, T_B, T_C, T_D, T_E, T_F, T_G, T_H):
    _TABLE.update(_t)

_KEYS = sorted(_TABLE.keys(), key=len, reverse=True)
_ZH_RE = re.compile(r"[\u4e00-\u9fff]")
_PATTERN = re.compile("|".join(re.escape(k) for k in _KEYS))

# 中文标点 → 英文（避免"xx，yy"残留为半中半英）
_PUNCT = str.maketrans({
    "，": ", ", "。": ". ", "：": ": ", "；": "; ", "！": "! ",
    "？": "? ", "（": " (", "）": ") ", "、": ", ",
    "“": '"', "”": '"', "‘": "'", "’": "'", "…": "...",
})
_MULTI_SPACE = re.compile(r"[ \t]+")


def translate(text: str) -> str:
    """把文本里的中文片段替换为英文；无中文则原样返回。"""
    if not text or not _ZH_RE.search(text):
        return text
    out = _PATTERN.sub(lambda m: _TABLE[m.group(0)], text)
    out = out.translate(_PUNCT)
    return _MULTI_SPACE.sub(" ", out).strip()


def _en_translator(logger_name: str, message_text: str) -> str:
    return translate(str(message_text or ""))


class _EnLogFilter(logging.Filter):
    """兜底：翻译不走 SecureLogger 的标准 logging 记录（控制台与文件均英文）。"""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            msg = record.getMessage()
        except Exception:
            return True
        new = translate(msg)
        if new != msg:
            record.msg = new
            record.args = ()
        # 同步翻译展示/原文两个字段（文件日志也英文）
        for attr in ("codex_display_message_text", "codex_original_message_text"):
            val = getattr(record, attr, None)
            if val:
                setattr(record, attr, translate(val))
        return True


_patched = False
_filter_installed = False


def _patch_emit(secure_logger) -> None:
    """包装 SecureLogger._emit：落日志前先把 msg 翻译为英文，
    使 codex_original_message_text（文件日志）同样为英文。"""
    cls = getattr(secure_logger, "SecureLogger", None)
    if cls is None or getattr(cls, "_en_logs_emit_patched", False):
        return
    _orig_emit = cls._emit

    def _emit_en(self, level, level_key, msg, *, exc_info=False):
        return _orig_emit(self, level, level_key, translate(str(msg or "")), exc_info=exc_info)

    cls._emit = _emit_en
    cls._en_logs_emit_patched = True


def _apply_secure_logger_patch() -> None:
    """接管 SecureLogger：cuteify 替换 + _emit 包装。幂等。

    直接从 sys.modules 取模块（不用 import 语句），避免在 config_parts
    包仍在部分初始化时触发"partially initialized module"异常。
    """
    global _patched
    if _patched:
        return
    secure_logger = sys.modules.get("app.core.config_parts.secure_logger")
    if secure_logger is None:
        # 尚未加载（register 兜底路径才会走到），尝试正常导入
        try:
            from app.core.config_parts import secure_logger
        except Exception as exc:  # 未安装壳补丁或路径变化时不强求
            logger.warning("[en_logs] cannot import secure_logger, fallback to std-logging translation only: %s", exc)
            return
    # 模块必须已执行完（SecureLogger 类已定义）。若仍在执行中，
    # 此刻替换 cuteify 会被随后的 `from .cute_translator import ...` 覆盖，
    # 故不置 _patched，等模块执行完后的下一次 import 钩子再接管。
    if getattr(secure_logger, "SecureLogger", None) is None:
        return
    _patched = True
    secure_logger._cuteify_info_message = _en_translator
    secure_logger._cuteify_debug_message = _en_translator
    secure_logger._cuteify_warning_message = _en_translator
    secure_logger._cuteify_error_message = _en_translator
    _patch_emit(secure_logger)


def install_early() -> None:
    """在 app 包导入之前调用：拦截 secure_logger 首次导入并立即接管，
    让启动初期的 app 初始化日志同样输出英文。幂等。"""
    import builtins
    if getattr(builtins, "_en_logs_import_hooked", False):
        return
    _orig_import = builtins.__import__
    _target = "app.core.config_parts.secure_logger"

    def _hooked(name, globals=None, locals=None, fromlist=(), level=0):
        module = _orig_import(name, globals, locals, fromlist, level)
        # 不依赖 name 精确值（`from app.core.config_parts import secure_logger`
        # 的 name 是父包名），只要目标模块已进入 sys.modules 就接管
        if not _patched and _target in sys.modules:
            _apply_secure_logger_patch()
        return module

    builtins.__import__ = _hooked
    builtins._en_logs_import_hooked = True


def register(host) -> None:
    global _filter_installed
    _apply_secure_logger_patch()

    # 兜底翻译标准 logging 日志。挂在 root 的 handlers 上
    # （Logger.filters 对子 logger 冒泡上来的记录不生效）。
    # 壳补丁已保证 boot() 在 basicConfig 之后执行，此处 root.handlers 已就绪。
    if not _filter_installed:
        _filter_installed = True
        root = logging.getLogger()
        if root.handlers:
            for h in root.handlers:
                if not any(isinstance(f, _EnLogFilter) for f in h.filters):
                    h.addFilter(_EnLogFilter())
        else:
            if not any(isinstance(f, _EnLogFilter) for f in root.filters):
                root.addFilter(_EnLogFilter())

    logger.info("[en_logs] console+file log English translation enabled (%d rules)", len(_TABLE))
