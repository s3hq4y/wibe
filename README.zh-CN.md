<p align="center">
  <img src="./docs/reference_shape_vscode.svg" alt="Wibe — 基于 Code - OSS 的本地 AI 桥" width="100%">
</p>

<p align="center">
  <a href="./WIBE_VERSION"><img src="https://img.shields.io/badge/%E7%89%88%E6%9C%AC-alpha--1.0.1--base--1.136.1-00A34D?style=flat-square&labelColor=071A10" alt="版本 alpha-1.0.1-base-1.136.1"></a>
  <a href="https://github.com/microsoft/vscode"><img src="https://img.shields.io/badge/%E4%B8%8A%E6%B8%B8-Code%20--%20OSS%201.136.1-3178C6?style=flat-square&labelColor=071A10" alt="上游 Code - OSS 1.136.1"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-AGPL--3.0-8A2BE2?style=flat-square&labelColor=071A10" alt="许可证 AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows-0078D6?style=flat-square&labelColor=071A10" alt="平台 Windows">
  <img src="https://img.shields.io/badge/%E6%9C%AC%E5%9C%B0%E6%8E%A5%E5%8F%A3-OpenAI%20%E5%85%BC%E5%AE%B9%20%3A8199-00F06E?style=flat-square&labelColor=071A10" alt="本地接口 OpenAI 兼容 :8199">
  <a href="https://chat.deepseek.com"><img src="https://img.shields.io/badge/%E5%B7%B2%E5%9C%A8-DeepSeek%20%E9%AA%8C%E8%AF%81-4D6BFF?style=flat-square&labelColor=071A10&logo=deepseek&logoColor=white" alt="已在 DeepSeek 验证"></a>
</p>

# Wibe

[English](README.md) · **简体中文**

Wibe 是基于 [Visual Studio Code — Open Source](https://github.com/microsoft/vscode)（**Code - OSS 1.136.1**）的桌面编辑器。编辑器、扩展宿主、用户目录布局都跟上游一致；在此之上加了一层**本地 Agent**：用你已经登录的 AI 网页，在本机真实浏览器里对话。

**版本：** `alpha-1.0.1-base-1.136.1`
Wibe **1.0.0 alpha**，基线为 Code - OSS **1.136.1**。

> **仅在 DeepSeek**（[chat.deepseek.com](https://chat.deepseek.com)）上验证过功能。Sidecar 里其它站点可能有内置适配，但**本 alpha 未测试**。

---

## 它解决什么问题

多数「AI IDE」把仓库发到云端 API。Wibe 反过来：

1. 在 Wibe 拉起的**受控 Chrome**里，登录 ChatGPT、Claude、Gemini、DeepSeek、Kimi……
2. 本地 Python sidecar（**UWA**）把已登录的标签页变成 OpenAI 兼容接口 `http://127.0.0.1:8199/v1`。
3. 内置 **InControl** 聊天连这个接口。每个 IDE 会话绑定一个网页对话：侧栏续聊 = 同一网页续聊；压缩对话 / 切模型 = 网页开新会话并改绑。

除了你本来就会打到那些网站的流量，数据不出本机。

---

## 运行

1. 从已打包的 Windows 构建里启动 `Wibe.exe`。
2. 等受控 Chrome 窗口出现，登录 **DeepSeek**（本构建唯一测过的站点），并停在可对话页面。
3. 打开侧栏 InControl 聊天，正常说话即可。

**启动时不再自动用系统浏览器打开教程 / 说明页。** 需要时自己打开：

| 用途 | 地址 |
| --- | --- |
| Sidecar 控制台 | http://127.0.0.1:8199 |
| 教程 | http://127.0.0.1:8199/static/tutorial/index.html |
| OpenAI 兼容 Base URL | `http://127.0.0.1:8199/v1` |

用户目录仍是 `.vscode-oss`，因此可以沿用原 Code - OSS 的配置，也可以和原版并排运行（互斥体不同）。

---

## 相对原版 Code - OSS 多了什么

| 方面 | 原版 | Wibe |
| --- | --- | --- |
| 产品名 / 图标 | Code - OSS | **Wibe**（只改显示层） |
| 聊天 | Copilot / 无 | 内置 **InControl** |
| 模型从哪来 | 云端 API Key | **UWA sidecar** → 你已登录的 AI 网页 |
| 会话身份 | 无 | 一个 IDE 会话 ↔ 一个网页对话 URL |
| 压缩 / 切模型 | 无 | 摘要后在网页**开新会话**并改绑 |
| 配置路径 / 命令行 / URI | `.vscode-oss`、`code-oss://` | **故意不改** |

更细的地图：[docs/uwa-vs-vanilla-vscode.md](docs/uwa-vs-vanilla-vscode.md)（相对上游的 diff）、[docs/uwa-incontrol-bridge.md](docs/uwa-incontrol-bridge.md)（协议）。

```
Wibe.exe  (Electron / Code - OSS)
  └── extensions/incontrol          TypeScript 聊天客户端
        │  拉起、探活、关闭
        ▼
     uwa-sidecar  (Python, :8199)   OpenAI 兼容 API + 控制台
        │  驱动
        ▼
     Chrome --remote-debugging-port=9222
        └── DeepSeek（已测）/ 其它站点（未测）
```

---

## 从源码构建

需要 `.nvmrc` 对应的 **Node.js**、**Python 3.10+**，以及 Chrome / Edge / Brave 等 Chromium 浏览器。

```bash
npm install
npm run build-fast              # 快速编译工作台
npm run build-fast-extensions   # 扩展媒体有改动时
npm run compile                 # 完整客户端 + copilot
```

日常不必跑完整 gulp 打包。改完 InControl 或 sidecar 后，把这两个目录镜像进已打包应用的 `resources/app/`，再 Reload Window：

```
本仓库
  extensions/incontrol/
  resources/uwa-sidecar/
        │  镜像
        ▼
<已打包应用>/resources/app/
  extensions/incontrol/
  resources/uwa-sidecar/
```

**不要改** `resources/uwa-sidecar/app/core/`。Sidecar 定制走 `resources/uwa-sidecar/uwa-plugins/`，否则上游 sidecar 一更新就会把桥接冲掉。

---

## 目录

| 路径 | 作用 |
| --- | --- |
| `product.json` | 显示名改牌（`nameShort` / `nameLong` = Wibe）。`applicationName`、`dataFolderName` 仍是 `code-oss` / `.vscode-oss`。 |
| `extensions/incontrol/` | 聊天 UI、会话槽位、压缩、sidecar 生命周期 |
| `resources/uwa-sidecar/` | 本地 Web-to-API 服务 |
| `docs/` | 桥接协议、相对原版说明 |
| `BRIDGE.md` | 短契约 / 不能破坏的规则 |
| `WIBE_VERSION` | 展示版本（`alpha-1.0.1-base-1.136.1`） |

---

## 当成本地 API 用

任何 OpenAI 兼容客户端都可以指向 sidecar（IDE 已经在用）：

```
Base URL:  http://127.0.0.1:8199/v1
API key:   AUTH_ENABLED=false（默认）时填任意字符串即可
```

Sidecar 内置了若干站点的选择器（ChatGPT、Claude、Gemini、DeepSeek、Kimi、通义、Grok、豆包、Google AI Studio、Arena）。**本 alpha 只测过 DeepSeek**，其余视为未验证。

---

## 说明

- 仅供个人研究与本地调试。请遵守各网站服务条款。这是本机浏览器自动化桥，不是托管代理，也不提供绕过登录、验证码或付费墙的能力。
- AGPL-3.0。
- 反馈入口见 `product.json` 的 `reportIssueUrl`。

## 致谢

- 感谢 lumingya 的 universal-web-api 项目 https://github.com/lumingya/universal-web-api ，本项目的 uwa-sidecar 基于此制作并适配。
- 感谢 continuedev 的 Continue 项目 https://github.com/continuedev/continue ，本项目的 incontrol 是 Continue 1.3.40 的 fork 自定义版。
