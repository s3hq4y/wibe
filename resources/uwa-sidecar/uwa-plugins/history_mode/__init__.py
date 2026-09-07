"""history_mode 插件 —— 多轮历史模式（auto/full/last）+ 会话亲和续聊 + skip_on_continuation。

供 plugin_host 加载：loader 会 import 本包并调用 register(host)。
"""
from . import hooks


def register(host):
    hooks.register(host)


__all__ = ["register"]
