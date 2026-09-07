"""plugin_host —— 极简插件宿主（钩子壳运行时）。

用法：
1. 将 plugin_host/ 目录放到项目根目录（与 main.py 同级）；
2. 在 main.py 中调用 boot()（见壳补丁）；
3. 插件放在 uwa-plugins/<插件名>/ 下，含 plugin.json 与 register(host) 入口。
"""
from .hooks import HookRegistry, UNSET, plugin_hooks
from .loader import load_plugins


def boot() -> int:
    """启动插件系统：加载所有插件包。幂等。返回加载成功的插件数。"""
    return load_plugins()


__all__ = ["HookRegistry", "plugin_hooks", "UNSET", "boot"]
