# Wibe

**Wibe** 是基于 [Visual Studio Code — Open Source](https://github.com/microsoft/vscode)（`Code - OSS` **1.136.1**）
的个人改版构建。编辑器主体保持上游不变，在此之上叠加了两件事：

1. **Agent / 对话桥接**：接入本地 sidecar（内部代号 *uwa* / *InControl*），让工作台对话可以驱动一个由浏览器支撑的
   模型运行时——按会话隔离的绑定槽位、历史会话恢复、目标压缩 → 摘要 → 新会话，以及"手动刷新可用模型"。
   详见 [`docs/uwa-incontrol-bridge.md`](docs/uwa-incontrol-bridge.md)、[`docs/uwa-vs-vanilla-vscode.md`](docs/uwa-vs-vanilla-vscode.md)。
2. **独立品牌**：产品名为 **Wibe**，全部产品图标换成单色"拱门"标志。

[English](README.md) · 简体中文

---

## 改名：产品名称

只改 `product.json` 的**显示层**，因此现有安装的用户目录、扩展、命令行、深链全部原样继承：

| `product.json` 字段 | 改前 | 改后 | 出现位置 |
| --- | --- | --- | --- |
| `nameShort` | `Code - OSS` | `Wibe` | 菜单、关于对话框、窗口标题 |
| `nameLong` | `Code - OSS` | `Wibe` | 窗口标题后缀 |
| `win32NameVersion` | `Microsoft Code OSS` | `Wibe` | `Wibe.exe` 文件属性、任务栏提示 |
| `win32DirName` | `Microsoft Code OSS` | `Wibe` | 开始菜单文件夹名 |
| `win32ShellNameShort` | `C&ode - OSS` | `W&ibe` | 开始菜单快捷方式名 |
| `win32RegValueName` | `CodeOSS` | `Wibe` | `HKCU\Software\Classes` 外壳项 |
| `win32AppUserModelId` | `Microsoft.CodeOSS` | `Wibe.Desktop` | 任务栏分组、通知 |
| `win32MutexName` | `vscodeoss` | `wibe` | 单实例互斥体（顺带让 Wibe 与原版 Code - OSS 可同时运行） |
| `reportIssueUrl` | microsoft/vscode | 本仓库 `/issues/new` | 帮助 → 报告问题 |

**刻意不改**（改了会让配置、扩展、命令行"看起来像重装"）：

`applicationName`（`code-oss`）· `dataFolderName`（`.vscode-oss`）· `sharedDataFolderName` · `urlProtocol`（`code-oss`）
· `serverApplicationName` / `serverDataFolderName` / `tunnelApplicationName` · `linuxIconName` · `darwinBundleIdentifier`
· `package.json` 的 `name`（`code-oss-dev`，被 `build/`、`.vscode/launch.json`、agent skills 引用）· MIT 相关 `license*` 字段与 `LICENSE.txt`。

## 改名：图标集

19 个受版本管理的图标资源统一为一张图：由上游轮廓派生的扁平单色拱门，逐尺寸原生渲染（不做缩放重采样），
并保留主题语义（浅色 10 % 不透明度、深色 30 %、高对比度为纯色 `#D9D9D9` / `#3C3C3C`、Sessions 为纯灰）：

| 资源 | 用途 |
| --- | --- |
| `src/vs/workbench/browser/media/code-icon.svg` | 工作台产品图标（对话框、空工作台） |
| `src/vs/workbench/browser/parts/editor/media/letterpress-{light,dark,hcLight,hcDark}.svg` | 编辑器标签页压印底纹 |
| `src/vs/sessions/browser/media/vscode-icon.svg` | Sessions 启动页与标题 |
| `src/vs/sessions/contrib/chat/browser/media/letterpress-sessions-{light,dark}.svg` | 对话区压印底纹 |
| `resources/win32/code.ico` | `Wibe.exe` 资源图标、快捷方式 |
| `resources/win32/code_70x70.png`、`code_150x150.png` | 开始菜单 / 通知图块 |
| `resources/linux/code.png` | Linux 窗口图标 |
| `resources/darwin/code.icns` | macOS 图标包（11 个尺寸，16 → 1024 px） |
| `resources/server/code-192.png`、`code-512.png`、`favicon.ico` | `code-server` / tunnel 网页端 |
| `extensions/github-authentication/media/code-icon.svg`、`favicon.ico` | 登录页图标与 favicon |
| `extensions/microsoft-authentication/media/favicon.ico` | 登录页 favicon |

母版图见 [`docs/reference_shape_vscode.svg`](docs/reference_shape_vscode.svg)（3105 B）。

## 构建

```bash
npm install                    # 一次性
npm run build-fast             # 快速开发构建（node build/next/index.ts build-fast）
npm run build-fast-extensions  # codicons 与扩展媒体资源，改动扩展时用
npm run compile                # 完整编译客户端 + copilot
```

想看到改名效果并不一定要跑完整打包：已构建目录里的 `resources/app/product.json` 可以就地替换，
可执行文件的图标资源也能用 `rcedit` 直接替换。本仓库用过的脚本放在 `.build/iconwork/`（已被 git 忽略），
它们会把新的 `product.json`、打包版 `package.json`、`VisualElementsManifest.xml`、两个 `bin` 启动器铺好，
再把 `Code - OSS.exe` 重命名为 `Wibe.exe`。

## 打补丁后的构建目录结构

```
vscode-1.136.1/            本仓库（唯一事实来源）
  product.json             显示层改名就在这里
  .build/iconwork/         暂存文件、生成脚本、日志（git 忽略）
  .build/icon-backup-*/    原始文件与 rcedit 之前的 exe（git 忽略）
../VSCode-win32-x64/       可直接运行的产品树
  Wibe.exe                 已重命名并换过图标的可执行文件（文件版本名 Wibe）
  Wibe.VisualElementsManifest.xml   ShortDisplayName="Wibe"
  bin/code-oss[.cmd]       名字不变，但已指向 Wibe.exe
  bin/wibe[.cmd]           同一份启动器的 Wibe 品牌别名
  resources/app/product.json   打好的副本（构建时间戳里的 commit/version 保持原值）
```

## 回退

* 源码侧：`git checkout -- product.json README.md extensions resources src` 且 `git clean -f README.zh-CN.md`
* 产品树：从 `.build\icon-backup-<时间戳>-nameswap\` 恢复（product.json、package.json、清单、`bin\*`），
  再把 `Wibe.exe` 改回原名；`rcedit` 之前的原始 exe 保存在 `.build\icon-backup-<时间戳>-tree\Code - OSS.exe.pre-icon`。
* Windows 可能仍显示缓存图标：脚本已调用 `SHChangeNotify(0x08000000, …)`；被钉选的快捷方式需要取消钉选再钉一次。

## 上游与许可

上游：<https://github.com/microsoft/vscode>，`1.136.1`。源码仍按 [MIT 许可](LICENSE.txt) 发布并保留原版权声明；
图标为上游 VS Code 标志的派生作品。Wibe 与 Microsoft 无隶属、无赞助、无背书关系。
