"""incon_bridge —— IDE 桥接插件。

提供 ide 历史模式（显式控制新对话）与 conversation_url 回传，
供 extensions/incontrol 扩展驱动压缩迁移 / 切模型迁移。
"""
from .hooks import register, set_request_extension, get_request_extension

__all__ = ["register", "set_request_extension", "get_request_extension"]
