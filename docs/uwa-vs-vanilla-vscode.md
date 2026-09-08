# 本项目相对原版 VS Code（code-oss）的改动说明

> 本文写给**接手本仓库的下一个 AI / 开发者**：用最少时间搞清楚「本仓库与上游 code-oss 差在哪、改了什么、为什么、以及工作时不能回退的点」。
>
> - 协议 / 数据流逐行细节 → 看 `docs/uwa-incontrol-bridge.md`
> - 桥接层顶层铁律 → 看根目录 `BRIDGE.md`
> - 2026-09-08 的会话状态快照 → 看根目录 `UWA_BRIDGE_SESSION_SUMMARY_20260908.md`
>
> 本文基于 2026-09-08~09 的仓库状态撰写；若与代码不符，以代码和上述文档为准。

---

## 0. TL;DR

本仓库 = **上游 code-oss（v1.136.1 基线）＋一个自研「incontrol × uwa-sidecar」桥接层**。

核心思路：VS Code 里的聊天由扩展 `extensions/incontrol`（OpenAI 兼容客户端）承担；它 spawn 一个 Python
sidecar（`resources/uwa-sidecar`），由 sidecar 驱动真实 Chrome 打开**网页版 AI（DeepSeek / Gemini / ChatGPT …）**
的网页对话，并把网页包装成 `POST /v1/chat/completions`。于是：

- IDE 里继续聊天 → 网页上**同一个**会话继续；
- IDE 里手动「压缩对话」/ 切模型 → 网页上**开新会话**，并让 IDE 记住新会话地址（下次续聊打回新会话）。

除这套桥接层外，本仓库其余部分与上游差异极小。仓库另做了 `.gitignore` 收尾，把运行期杂项
（浏览器 profile、对话历史数据、日志、备份、本地脚本）挡在版本控制之外。

```
Electron / VS Code 主进程
  └── extensions/incontrol                (扩展宿主, TypeScript)
        │  ① activate 时 spawn, 带 HISTORY_MODE=ide 等环境变量
        ▼
     python resources/uwa-sidecar/main.py  ──►  127.0.0.1:8199  (OpenAI 兼容 API + Dashboard)
        │  ② 自行拉起
        ▼
     chrome.exe --remote-debugging-port=9222 ──► 网页版 AI（受控浏览器, 使用 e2e 测试 profile）
```

---

## 1. 相对上游：新增 / 改动在哪些目录

### 1.1 功能性新增（已进 git，原版没有）

| 路径 | 是什么 |
|---|---|
| `extensions/incontrol/` | 自研扩展本体（TS）。内含 `bridge/`（协议、conversationBridge、激活）、`core/`（llm 路由、会话上下文、压缩迁移）、`gui/`（聊天 UI、手动「压缩对话」按钮等） |
| `resources/uwa-sidecar/` | Python sidecar（FastAPI）。`bridge/protocol.py` 是 `protocol.ts` 的镜像；`uwa-plugins/incon_bridge/`（`hooks.py` / `api_patch.py` / `ide_mode.py`）是本项目的定制插件 |
| `BRIDGE.md` | 顶层桥接说明 + 铁律（不要改 `resources/uwa-sidecar/app/core/`，定制走 `uwa-plugins/`） |
| `docs/` | 本文档 + `uwa-incontrol-bridge.md`（详细协议/链路） |
| `UWA_BRIDGE_SESSION_SUMMARY_20260908.md` | 仓库根的历史会话状态快照（2026-09-08），由提交 `9c7f0012` 加入 |
| `.gitignore`（追加段） | 忽略 uwa 运行期杂项（见 §1.2） |

### 1.2 仓库里刻意「被忽略 / 不提交」的东西（不是漏传！）

| 路径 | 原因 |
|---|---|
| `resources/uwa-sidecar/chrome_profile*/` | e2e 测试浏览器的**浏览历史 / 对话历史 / 缓存 / Local State** 等运行数据（曾经的“满屏 U”元凶，97+ 文件） |
| `resources/uwa-sidecar/logs/`、`temp/`、`venv/`、`__pycache__/`、`_s.*` | 运行日志 / Python 环境 / 缓存 |
| `.portal/` | 远程执行工具的命令日志 |
| `*.bak-20260909-g2fix` | 修复前的代码备份（本地留档） |
| 根目录 `bridge/`、`core/`、`gui/` | **旧快照副本**：内容比 `extensions/incontrol/` 下已提交版本更老（例：其 `protocol.ts` 仍是 `PROTOCOL_VERSION=1`，已提交版本为 v2）。**不要再编辑、不要提交**；如需清理可删除 |
| `uwa_git2.ps1`、`uwa_push.ps1` | 本地 git 助手脚本，不进版本库 |

### 1.3 运行态环境（不在本 git 仓库内，但改代码必知）

- 用户机器上真正的产品位是 **`…\bridges\code-oss\VSCode-win32-x64\resources\app\`**：
  其 `extensions\incontrol\` 与 `resources\uwa-sidecar\` 是**实际被加载的运行副本**（含编译产物 `out/extension.js`、sidecar venv 与 `logs/app.log`）。
- 源码树（本仓库 `vscode-1.136.1\`）是开发位。改完代码需要**镜像到产品位并重启/Reload** 才生效（详见 §4、§5）。
- sidecar 是扩展子进程（`127.0.0.1:8199`），由扩展托管生命周期，重启要带 `HISTORY_MODE=ide` 环境变量才进入 IDE 模式。

---

## 2. 相对上游：功能级改动清单

对普通用户可见/可感知的行为差异，全部来自桥接层（上游 vanilla 行为未改动）：

1. **历史模式 `history_mode`**：请求可带 `"ide"`，表示由 IDE 显式决定「新对话还是续聊」，不再让 uwa 靠消息形状猜。
2. **会话绑定（槽位 / 指纹）**：扩展按 **IDE 会话 id**（`llm/streamChat.sessionId`，指纹 `uwaConversationFingerprint`）维护进程内 LRU 槽表，记录该 IDE 会话绑定的**网页对话 URL / turn**。多 IDE 会话各自绑自己的网页会话，互不串台。
3. **确定性路由 + resume**：命中槽的请求改发 `…/tab-url/<token>/v1/chat/completions`（adapter 旁路，对应“R3.1 raw-fetch 旁路”），并带 `resume_conversation_url`，sidecar 据此判“续聊”而非“开新”。
4. **手动「压缩对话」（GUI 按钮）→ 迁移**：扩展侧 `conversationCompaction.ts` 把历史压成摘要，**连同缓存的最新系统提示词**一起，经 `bridge/conversationBridge.migrate…` 以 `force_new_conversation=true` + `conversation_hint={reason:"compaction"}` 发出 → sidecar 在网页开新会话并全量打入（系统提示词+摘要）→ 新会话 URL 回传，扩展把槽位从旧 URL 改绑到新 URL。
5. **切模型迁移**：与压缩迁移同构（`reason:"model_switch"`），开新网页会话、带上下文、改绑槽。
6. **sidecar 定制插件 `incon_bridge`**：中间件解析请求扩展字段 → 钩子按 `ide_mode.py` 的**四级优先序**分类（forced_new / resume / continuation / first_turn）→ 决定网页端“点新建”还是“只打增量”。
7. **响应扩展字段 `x_uwa`**：sidecar 在响应（含 SSE）里带回 `conversation_url / conversation_id / tab_index / turn`，扩展据此更新槽位。

> 想快速体验差异：打开扩展的聊天，先聊几句，点「压缩对话」，再继续 —— 网页端会出现一个**新**会话并带上摘要，后续消息全部续到新会话上（`reason=ide_mode_resume`）。

---

## 3. 改动文件地图（路标）

| 关注点 | 文件 | 一句话说明 |
|---|---|---|
| 协议（TS） | `extensions/incontrol/bridge/protocol.ts` | 请求扩展字段 + `PROTOCOL_VERSION`（当前 v2） |
| 会话槽 / 指纹 / 系统提示词缓存 / trace | `extensions/incontrol/core/util/uwaRequestContext.ts` | LRU 槽表、`uwaConversationFingerprint`、`remember/getUwaSystemPrompt`、`recordUwaResponseExt` |
| 请求路由与 resume 注入 | `extensions/incontrol/core/llm/index.ts` | 把扩展字段挂到请求体、按槽定向到 `/tab-url/…`；**保留 R3.1 raw-fetch 旁路** |
| 压缩迁移（扩展侧） | `extensions/incontrol/bridge/*`、`extensions/incontrol/core/util/conversationCompaction.ts` | 压缩 → 摘要 + 系统提示词 → 迁移请求 |
| GUI | `extensions/incontrol/gui/…/CompactConversationButton.tsx` 等 | 手动「压缩对话」按钮；`Chat.tsx` 承载会话绑定展示 |
| sidecar 入口/服务 | `resources/uwa-sidecar/`（`main.py`、`app/core/` 上游件） | **`app/core/` 不要改**，升级会冲突 |
| 协议（Python） | `resources/uwa-sidecar/bridge/protocol.py` | 与 `protocol.ts` **必须镜像同步**（字段/枚举/版本号） |
| 定制插件 | `resources/uwa-sidecar/uwa-plugins/incon_bridge/{api_patch,hooks,ide_mode}.py` | 中间件解析 / 钩子注册与 ext 通道 / 四级分类判定 |
| 上游历史模式插件 | `resources/uwa-sidecar/uwa_plugins/history_mode/` | 轮次/历史判定的上游宿主（本项目以 `ide_mode` 覆盖/配合） |
| 顶层说明 | `BRIDGE.md`、`docs/` | 铁律与详细链路 |

---

## 4. 给接手方的工作铁律（不要违反）

1. **先读 `docs/uwa-incontrol-bridge.md` 和 `BRIDGE.md`** 再动手，很多坑已写死在那里。
2. **不要改 `resources/uwa-sidecar/app/core/`**（上游同步件）。定制一律走 `uwa-plugins/`。
3. **`protocol.ts` 与 `protocol.py` 必须同步改**（字段、枚举、`PROTOCOL_VERSION`），只改一侧会造成桥接错位。
4. **不要砍掉 `core/llm/index.ts` 里的 R3.1 raw-fetch 旁路 / `resume_conversation_url` 注入逻辑** —— 压缩迁移后的首条消息全靠它续到新会话；这是多轮验收里最容易“看着没坏其实回退”的地方。
5. **sidecar 钩子层不要用 `contextvars` 跨任务传请求扩展**（workflow 在独立任务/线程执行，会读成 `None`）。现在用的是**模块级全局 + `threading.Lock()`**（`hooks.set_request_extension` / `get_request_extension`）。改回 contextvar 等于让压缩迁移静默失效。
6. **`ide_mode.py` 的判序别调反**：`resume`（条件 2）必须先于“按消息形状判续聊/首轮”（条件 3/4）——否则压缩迁移后那条只有 system+1 条 user 的消息会被误判成“新会话首轮”再点新建（历史 Bug B）。
7. **双树同步**：源码树是本仓库；**实际加载的是产品位** `VSCode-win32-x64\resources\app\…`。改完 TS/Python 要同步到产品位（TS 变更通常需 `npm run esbuild` 产出 `out/extension.js` 后复制），然后 **VS Code `Developer: Reload Window`** 让扩展带 `HISTORY_MODE=ide` 重启 sidecar。
8. **别乱杀进程**：不要 kill 用户正在用的 VS Code 本体；也不要以为直接 kill sidecar 就会带环境变量重启——内部监督重启可能丢掉 `HISTORY_MODE=ide` 而退回 `mode=auto`（日志里 `[incon_bridge]` 行消失）。要重启就 **Reload Window**。
9. **提交前自查 git 状态**：运行期杂项已被 `.gitignore` 覆盖（chrome_profile\*、logs、.portal、\*.bak-\*、根目录 bridge/core/gui、两个 ps1）。新出现的杂项应**加 ignore**，而不是提交。
10. 改动关键文件前，习惯性在同目录留 `.bak-<日期戳>` 副本便于回退。

---

## 5. 调试入口速查

| 看什么 | 去哪看 | 特征串 |
|---|---|---|
| 扩展侧路由决策 | VS Code 输出通道 **uwa Sidecar**（落盘 profile `logs/<ts>/window1/exthost/output_logging_*/1-uwa Sidecar.log`） | `[uwa-route] adapter mode=ide forceNew=… slot url=…` |
| sidecar 分类判定 | 同通道 / `resources/uwa-sidecar/logs/app.log` | `[incon_bridge] ide mode: turn=… typed=a/b reason=… resume=…` |
| 压缩迁移 | 同通道 | `compaction completed … / migrating reason=compaction / migrated -> <url>` |
| 插件是否加载 | sidecar 启动段 | `[plugin_host] loaded plugin: incon_bridge`、`registered … 钩子 (ide mode)` |
| sidecar 进程 | `Get-NetTCPConnection -LocalPort 8199` | 扩展托管；Reload Window 带 `HISTORY_MODE=ide` 重启 |

一轮「压缩迁移」的验收标准：

1. 迁移请求 → `reason=ide_mode_forced_new` 且带 `trigger=compaction`；
2. 迁移后首条消息打进**新**网页会话，内容 = 系统提示词 + 摘要；
3. 随后的消息 → `reason=ide_mode_resume`，且不新开标签/对话。

---

## 6. 本仓库的 git 工作方式

- 分支 `master`；远端 `origin https://github.com/s3hq4y/code-oss.git`（真实远端，提交即公开）。
- 提交信息风格：`docs:` / `feat(ide):` / `fix(uwa):` / `chore(ide):`（见历史）。
- `docs/` 与代码改动均已推送；本地工作区应保持 `git status` 干净（运行期杂项靠 ignore 隐藏）。
- 未经用户同意不要把机器相关配置（如 `.vscode/settings.json` 里的本地 profile 名）或运行日志提交上去。

参考历史（截至 2026-09-08/09，`git log --oneline -6`）：

```
fdb4e1be chore(ide): ignore uwa e2e browser profiles, backups, stale root mirrors; drop stray .portal attr rule
f714f7ae feat(ide): sync incontrol <-> uwa sidecar integration changes
51144dcc docs: add uwa-sidecar x incontrol bridge integration guide
2dc0ce53 uwa bridge: goal2 compaction->summary->new web conversation, per-session binding url update; manual compact button in GUI
9c7f0012 uwa bridge: R3.1 fix tab-url direct route via adapter bypass + session summary 2026-09-08
0aba5145 fix(uwa): conversation binding slot key uses IDE session id (llm/streamChat.sessionId) …
```

---

## 7. 附录：关键词速查（供下一个 AI 检索本仓库）

`uwa-sidecar` · `incontrol` · `HISTORY_MODE=ide` · `ide_mode` · `resume_conversation_url` ·
`force_new_conversation` · `conversation_hint` · `system_prompt_mode` · `x_uwa` · `uwaConversationFingerprint` ·
`uwaRequestContext` · `conversationCompaction` · `CompactConversationButton` · `/tab-url/<token>` ·
`PROTOCOL_VERSION` · `chrome_profile_e2e` · `R3.1` · `adapter bypass` · `module-global + threading.Lock`
