# uwa_desktop —— GNOME 风格桌面控制台 + 受控浏览器引导页

通过 `DASHBOARD_FILE` 把 `/` 与 `/dashboard` 指向本插件自带的桌面控制台，
并用 Fluent UI 引导页覆写原版受控浏览器引导页。

## 组成

- `dashboard/index.html` —— GNOME 风格桌面（壁纸 + 顶栏 + Dock + 桌面图标 + 任务栏 + 窗口）
  - 标题与主机名已去除 Debian 字样（`UWA Desktop` / `uwa`）
  - 桌面与 Dock 已移除「使用指南」图标（受控浏览器提示不应出现在控制台）
- `guide.html` —— 受控浏览器引导页（Fluent UI，纯 CSS 渐变背景，无图片，中英双语 + 明暗主题）
- `__init__.py` —— 启动时：
  1. 设 `DASHBOARD_FILE` 接管控制台
  2. 把 `guide.html` 覆写 `static/controlled-browser-guide.html`（原版首次会备份为
     `guide.original.html`，幂等）

## 环境变量

| 变量 | 作用 |
|------|------|
| `UWA_DESKTOP_DISABLED=1` | 停用整个插件（桌面 + 引导页覆盖） |
| `UWA_DESKTOP_GUIDE_DISABLED=1` | 仅停用引导页覆盖（桌面仍接管） |

## 还原原版引导页

```powershell
git checkout -- static/controlled-browser-guide.html
```

或把 `uwa-plugins/uwa_desktop/guide.original.html` 复制回
`static/controlled-browser-guide.html`。

## 桌面图标配置

全部在 `dashboard/index.html` 文末的 `window.UWA_DESKTOP_CONFIG` 中：
`desktopIcons`（桌面）、`dockIcons`（左侧 Dock）、`tray`（顶栏托盘）。
icon 支持：内置图标 id / emoji / 内联 SVG。
