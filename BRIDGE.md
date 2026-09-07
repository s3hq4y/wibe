# 统一 IDE 桥接层

本仓库把三个项目合并到一棵源码树里：

```
vscode-1.136.1/
├── src/                          Code-OSS 本体 (TypeScript)
├── extensions/incontrol/         incon-mini —— VS Code 扩展 (TypeScript)
└── resources/uwa-sidecar/        uwa-modified —— Python 服务 (sidecar)
```

## 为什么 uwa 在 resources/ 而不是 extensions/

`uwa-modified` 是 Python 3.12 + FastAPI 服务，驱动一个独立的真实 Chrome
（`chrome_profile/`、`--remote-debugging-port=9222`）。它无法作为 Node 模块被
Electron 加载，只能以 **sidecar 子进程** 形式运行，由 incontrol 扩展托管生命周期。

`resources/` 是 VS Code 官方用于放置随产品分发的非 JS 资产的位置，
gulp 打包时会整体复制到应用目录，因此 sidecar 放这里能自动进入产物。

## 运行时拓扑

```
Electron 主进程
  └── extensions/incontrol  (扩展宿主)
        │  ① activate 时 spawn
        ▼
     python start.py  ──►  127.0.0.1:8199  (OpenAI 兼容 API)
        │  ② 自行拉起
        ▼
     chrome.exe :9222  ──►  网页版 AI (Arena / Gemini / DeepSeek ...)
```

- ① 扩展负责：启动、健康检查、优雅关闭（级联杀 Python + Chrome）
- ② uwa 负责：标签页池、会话亲和、多轮历史、CF 盾、代理轮换

## 桥接契约

两侧通过 `bridge/protocol.ts` ↔ `bridge/protocol.py` 共享同一份协议定义，
两个文件必须同步修改。核心扩展点：

| 能力 | uwa 侧实现位置 | 说明 |
|---|---|---|
| `history_mode: "ide"` | `uwa-plugins/incon_bridge/` | 类 `last` 但由 IDE 显式控制新对话 |
| 回传 `conversation_url` | 同上 | 响应里带 `x_uwa` 扩展字段 |
| `force_new_conversation` | 同上 | 压缩 / 切模型时命令开新对话 |

**重要：不要修改 `resources/uwa-sidecar/app/core/`。**
uwa 有 `updater.py` / `update_preserve.py` 上游同步机制，所有定制都必须
走 `uwa-plugins/` 插件钩子，否则升级会冲突。

现有钩子（`app/core/browser/workflow.py` 已埋点）：
`compute_turn_hint` / `resolve_history` / `step_should_skip` /
`find_affinity_session` / `on_workflow_end` / `on_workflow_finally`
