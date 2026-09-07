"""plugin_host.loader —— 扫描并加载 uwa-plugins/* 插件包。

插件包约定：
- 目录名即包名，需包含 plugin.json 清单；
- 包根提供 register(host) 函数，用于向 plugin_hooks 注册钩子；
- 加载失败只记日志，绝不影响主程序。
"""
from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path

from .hooks import plugin_hooks

logger = logging.getLogger("plugin_host")
_loaded = False


def discover_plugin_dirs():
    """返回需要扫描的插件目录列表（按优先级，去重）。"""
    dirs = []
    seen = set()

    def add(p: Path):
        if p.is_dir():
            r = str(p.resolve())
            if r not in seen:
                seen.add(r)
                dirs.append(p)

    for p in os.environ.get("UWA_PLUGIN_DIRS", "").split(os.pathsep):
        if p.strip():
            add(Path(p.strip()))
    # 默认目录：运行目录与 plugin_host 同级目录下的 uwa-plugins/
    add(Path.cwd() / "uwa-plugins")
    add(Path(__file__).resolve().parent.parent / "uwa-plugins")
    return dirs


def load_plugins() -> int:
    """加载所有插件包，返回成功加载数量。幂等。"""
    global _loaded
    if _loaded:
        return 0
    _loaded = True
    loaded = 0
    for d in discover_plugin_dirs():
        # 插件包目录本身加入 sys.path，才能 import <插件名> 包
        if str(d.resolve()) not in sys.path:
            sys.path.insert(0, str(d.resolve()))
        for entry in sorted(d.iterdir()):
            if not entry.is_dir() or not (entry / "plugin.json").is_file():
                continue
            pkg = entry.name
            try:
                mod = importlib.import_module(pkg)
                register = getattr(mod, "register", None)
                if callable(register):
                    register(plugin_hooks)
                    loaded += 1
                    logger.info(f"[plugin_host] 已加载插件: {pkg}")
                else:
                    logger.warning(f"[plugin_host] 插件 {pkg} 缺少 register(host) 入口，已跳过")
            except Exception:
                logger.exception(f"[plugin_host] 加载插件 {pkg} 失败，已跳过")
    return loaded
