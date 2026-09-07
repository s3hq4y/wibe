"""uwa_desktop 插件 —— GNOME 风格桌面控制台 + 受控浏览器引导页覆盖。

1. 把 DASHBOARD_FILE 指向本插件自带的桌面 index.html，
   在 / 与 /dashboard 上覆盖原控制台（原控制台仍可在桌面"设置"窗口中打开）。
2. 用本插件自带的 Fluent UI 引导页（guide.html，纯 CSS 无图片）
   覆写 static/controlled-browser-guide.html，替换原版带背景图的引导页。

禁用方式：
- UWA_DESKTOP_DISABLED=1        停用整个插件（桌面 + 引导页覆盖）
- UWA_DESKTOP_GUIDE_DISABLED=1  仅停用引导页覆盖（桌面仍接管）

还原原版引导页：删除 uwa-plugins/uwa_desktop/guide.original.html 后，
把它的内容复制回 static/controlled-browser-guide.html（或直接
`git checkout -- static/controlled-browser-guide.html`）。
"""
from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

logger = logging.getLogger("uwa.uwa_desktop")

_HERE = Path(__file__).resolve().parent
_HTML = _HERE / "dashboard" / "index.html"
_GUIDE = _HERE / "guide.html"
# 项目根目录：<root>/uwa-plugins/uwa_desktop/ 之上两级
_ROOT = _HERE.parent.parent


def register(host) -> None:
    if os.environ.get("UWA_DESKTOP_DISABLED", "").strip() == "1":
        logger.info("[uwa_desktop] 已被 UWA_DESKTOP_DISABLED 禁用")
        return
    _override_dashboard()
    _override_guide()


def _override_dashboard() -> None:
    if not _HTML.is_file():
        logger.warning(f"[uwa_desktop] 未找到桌面页面: {_HTML}")
        return
    os.environ["DASHBOARD_FILE"] = str(_HTML)
    logger.info(f"[uwa_desktop] 已接管控制台: {_HTML}")


def _override_guide() -> None:
    if os.environ.get("UWA_DESKTOP_GUIDE_DISABLED", "").strip() == "1":
        logger.info("[uwa_desktop] 引导页覆盖已被 UWA_DESKTOP_GUIDE_DISABLED 禁用")
        return
    if not _GUIDE.is_file():
        logger.warning(f"[uwa_desktop] 未找到引导页: {_GUIDE}")
        return
    target = _ROOT / "static" / "controlled-browser-guide.html"
    try:
        # 首次覆写前把原版备份到插件目录（幂等，不重复备份）
        backup = _HERE / "guide.original.html"
        if target.is_file() and not backup.exists():
            shutil.copyfile(target, backup)
        shutil.copyfile(_GUIDE, target)
        logger.info(f"[uwa_desktop] 已用 Fluent 引导页覆写原版: {target}")
    except Exception as exc:  # 目录/权限异常时不阻断启动
        logger.warning(f"[uwa_desktop] 覆写引导页失败: {exc}")
