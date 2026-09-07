"""plugin_host.hooks —— 极简插件钩子注册表。

设计目标：
- 无插件时，call() 原样返回 default —— 宿主行为与未打补丁的上游完全一致。
- 插件通过 register(name, fn) 挂载；fn 返回 UNSET 表示"不表态"（继续走默认）。
- 线程安全；后注册的处理器优先。
"""
from __future__ import annotations

import threading
from typing import Any, Callable, Dict, List


class _Unset:
    def __repr__(self) -> str:
        return "UNSET"


UNSET = _Unset()


class HookRegistry:
    """线程安全的钩子注册表。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._hooks: Dict[str, List[Callable[..., Any]]] = {}

    def register(self, name: str, fn: Callable[..., Any]) -> Callable[..., Any]:
        """注册一个钩子处理器；同名处理器后注册者优先。"""
        with self._lock:
            self._hooks.setdefault(name, []).append(fn)
        return fn

    def has(self, name: str) -> bool:
        with self._lock:
            return bool(self._hooks.get(name))

    def clear(self, name: str | None = None) -> None:
        with self._lock:
            if name is None:
                self._hooks.clear()
            else:
                self._hooks.pop(name, None)

    def call(self, name: str, *args: Any, default: Any = UNSET, **kwargs: Any) -> Any:
        """调用钩子。

        - 依次调用处理器（后注册优先），返回第一个非 UNSET 的结果；
        - 没有处理器或全部返回 UNSET 时，返回 default（未给 default 则返回 None）。
        """
        handlers = self._hooks.get(name)
        if handlers:
            for fn in reversed(handlers):
                result = fn(*args, **kwargs)
                if result is not UNSET:
                    return result
        return None if default is UNSET else default


#: 进程级单例：宿主（上游补丁点）与插件共用这一个注册表。
plugin_hooks = HookRegistry()
