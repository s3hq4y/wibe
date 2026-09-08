# uwa-sidecar × incontrol 连接与配合说明

> 本文说明 **incontrol(VS Code 扩展/OpenAI 兼容客户端)** 与 **uwa-sidecar(Python + FastAPI 的 Web-to-API 服务)**
> 之间如何连接、如何协同完成「IDE 会话 ↔ 网页 AI 对话」的同步。配套顶层文档见根目录 `BRIDGE.md`。
>
> 适用版本：`PROTOCOL_VERSION = 2`

---

## 1. 一句话概括

incontrol 是跑在 VS Code 扩展宿主里的 **OpenAI 兼容客户端**；uwa-sidecar 是 incontrol 启动的一个
**sidecar 子进程**，它驱动一个真实的 Chrome，把任意网页版 AI（DeepSeek / Gemini / ChatGPT …）包装成
`/v1/chat/completions`。两者通过一份**共享协议**和少量**请求/响应扩展字段**实现：
IDE 里继续对话 → 网页上同一个会话继续；IDE 压缩/切模型 → 网页上开新会话并让 IDE 记住新会话地址。

```
Electron / VS Code 主进程
  └── extensions/incontrol                      (扩展宿主, TypeScript)
        │  ① activate 时 spawn
        ▼
     python resources/uwa-sidecar/main.py  ──►  127.0.0.1:8199   (OpenAI 兼容 API + Dashboard)
        │  ② 自行拉起
        ▼
     chrome.exe --remote-debugging-port=9222  ──►  网页版 AI（受控浏览器）
```

- ① 扩展负责 sidecar 生命周期：启动、健康检查、异常自动重启、随窗口优雅关闭（级联杀 Python+Chrome）。
- ② sidecar 负责网页侧脏活：标签页池、会话亲和、多轮历史、CF 盾、模型/预设选择、响应解析。

> 实测运行中的 sidecar 命令行形如：
> `python.exe …\resources\uwa-sidecar\venv\Scripts\python.exe …\resources\uwa-sidecar\main.py (port 8199)`。
> 用 `Get-NetTCPConnection -LocalPort 8199` 可定位它；**扩展 Reload Window 会带环境变量重新拉起**。

---

## 2. 代码位置（本仓库合并树内）

| 侧 | 路径 | 说明 |
|---|---|---|
| 扩展（TS） | `extensions/incontrol/` | incontrol 扩展本体（含 GUI、core、bridge） |
| 协议（TS） | `extensions/incontrol/bridge/protocol.ts` | 请求扩展字段 + 版本号 |
| 会话/指纹/系统提示词缓存 | `extensions/incontrol/core/util/uwaRequestContext.ts` | 槽位、指纹、`uwaTrace` |
| 请求注入/压缩迁移 | `extensions/incontrol/core/llm/index.ts` | 把扩展字段挂到请求体、按槽定向 |
| 压缩事件/迁移触发 | `extensions/incontrol/bridge/`、`core/util/conversationCompaction.ts` | compaction → 摘要 → 迁移 |
| GUI 压缩按钮 | `extensions/incontrol/gui/…/CompactConversationButton.tsx` 等 | 手动「压缩对话」 |
| sidecar（Python） | `resources/uwa-sidecar/` | FastAPI 服务 |
| 协议（Python） | `resources/uwa-sidecar/bridge/protocol.py` | 与 protocol.ts 镜像 |
| 定制插件 | `resources/uwa-sidecar/uwa-plugins/incon_bridge/` | `hooks.py` / `ide_mode.py` / `api_patch.py` |
| 上游插件 | `resources/uwa-sidecar/uwa_plugins/history_mode/` | 轮次/历史判定宿主 |

**铁律：不要改 `resources/uwa-sidecar/app/core/`。** uwa 有 `updater.py` / `update_preserve.py`
上游同步机制，所有定制只能走 `uwa-plugins/` 钩子，否则升级冲突。`api_patch.py`、`hooks.py`、
`ide_mode.py` 都属于插件，可自由修改。

---

## 3. 桥接契约（请求方向）

两侧共享协议定义，**`protocol.ts` 与 `protocol.py` 必须同步修改**（同一字段、同一枚举）。

### 3.1 请求体根节点上扩展的字段

incontrol 在发送 `POST /v1/chat/completions` 前，把下面这些字段并进请求体（`stream`/`model`/`messages`
为 OpenAI 标准字段，不在此列）。sidecar 的 `api_patch.py` 中间件读出请求体，用
`UwaRequestExtension.from_payload(payload)` 解析成本侧对象。

| 字段 | 类型 | 含义 |
|---|---|---|
| `history_mode` | `"ide" \| "auto" \| …` | `"ide"` 表示由 IDE 显式控制新对话/续聊（走 incon_bridge 插件） |
| `force_new_conversation` | `bool` | 命令开新对话（压缩迁移、切模型时置 true） |
| `system_prompt_mode` | `"inject_once" \| "always" \| "never"` | 系统提示词注入策略 |
| `conversation_hint` | `{reason, prev_conversation_url}` | 迁移/切模型意图；`reason∈{compaction, model_switch, manual}` |
| `resume_conversation_url` | `string` | IDE 声明"本请求续聊该网页对话"（压缩迁移后首条消息的关键） |

> 其它 IDE 会话标识（`uwaSessionKey` 等）在扩展内以**非枚举属性**挂载，不进序列化 JSON，只在 TS 侧决策使用。

### 3.2 sidecar 侧解析链路（重点：别再用 contextvars）

```
请求体 JSON
  → api_patch 中间件（FastAPI, is_chat = path 含 "chat/completions"）
      raw = await request.body()
      ext = proto.UwaRequestExtension.from_payload(payload)
      hooks.set_request_extension(ext)        # 模块级全局 + 锁
  → call_next(request)  →  workflow 流式执行
      resolve_history 钩子（history_mode == "ide" 时进入本插件）
      ext = hooks.get_request_extension()     # 读取本次请求扩展字段
```

⚠️ **已知深坑**：`set_request_extension` 曾用 `contextvars.ContextVar` 传递，但 workflow/浏览器执行发生在
**独立异步任务或线程**里，contextvar 跨任务不可见 → 钩子里永远读到 `None`，导致 `force_new` /
`conversation_hint` / `resume_conversation_url` **全部失效**（日志里表现为迁移请求没有 `trigger=compaction`）。
修复：改为**模块级全局变量 + `threading.Lock()`**（与插件既有 `_LAST_XUWA` 同一套路；IDE 场景单请求串行可接受）。
修改此类跨层传递时，务必先确认目标代码在哪个任务/线程运行。

### 3.3 响应方向：`x_uwa`

sidecar 在响应里附加 `x_uwa` 扩展字段（流式：SSE 追加在 `[DONE]` 之前的末帧；非流式：JSON 根字段）。
内容由 `hooks.on_workflow_end` 收尾时写入 `_LAST_XUWA`：

```jsonc
"x_uwa": {
  "conversation_url": "https://chat.deepseek.com/a/chat/s/<uuid>",
  "conversation_id":  "/a/chat/s/<uuid>",
  "tab_index": 1,
  "turn": 4,
  "history_mode": "ide"
}
```

incontrol 端 `openAIAdapterStream` / `openAIAdapterNonStream` 读到 `x_uwa` 后调用
`recordUwaResponseExt`，把 `conversation_url/turn` 写回本会话的槽位（见 §4）。

---

## 4. incontrol 侧状态：会话指纹与槽位

`core/util/uwaRequestContext.ts` 维护一张进程内 LRU 表（上限 32 项），键是**会话指纹**：

```ts
uwaConversationFingerprint(messages, uwaSessionKey)
// 有 sessionKey → sha1("sid:" + sessionId)；否则取第一条非空 user 文本的指纹
```

| API | 作用 |
|---|---|
| `getUwaConversationState(fp)` | 查槽：`{conversationUrl, conversationId, tabIndex, turn, updatedAt}` |
| `setUwaConversationStateForSession(sessionId, url)` | 绑定/更新 URL（迁移后改绑新会话） |
| `rememberUwaSystemPrompt(sessionId, text)` / `getUwaSystemPrompt(sessionId)` | 每次请求发出的 system 文本缓存（压缩用） |

决策发生在 `core/llm/index.ts` 的 `streamChat` 路由块：

```
mode=="ide" && !forceNew && fp && apiBase 命中 uwa
  ├─ 槽有 conversationUrl
  │    ├─ target = prepareUwaTargetUrl(origin, url)   →  /tab-url/<token>/v1/chat/completions  确定性路由
  │    └─ body.resume_conversation_url = url           →  sidecar 据此判“续聊”，不再凭消息形状
  └─ 槽 MISS（新会话）→ 走默认端点，由 sidecar 按消息形状开新对话
```

> 诊断：扩展把决策打到 VS Code 输出通道「uwa Sidecar」，行前缀 `[uwa-route]`，例如
> `adapter mode=ide forceNew=false fp=… slot url=… turn=… / adapter target=…/tab-url/<token>…`。

---

## 5. sidecar 侧判定：`ide_mode.py` 的四种结果

`resolve_ide_mode(...)` 统一在插件 `uwa-plugins/incon_bridge/ide_mode.py`。优先序从高到低：

| 优先级 | 条件 | 结果 `reason` | typed |
|---|---|---|---|
| 1 | `force_new_conversation` | `ide_mode_forced_new` | 全量历史进新对话 |
| 2 | `resume_conversation_url` 与 **session.conversation_url 或 tab.url 同会话**（`_same_conversation_url`，路径互为包含） | `ide_mode_resume` | 只打字增量（续聊） |
| 3 | 请求自带 assistant 回复，或 user 消息 ≥ 2 条 | `ide_mode_continuation` | 增量（续聊） |
| 4 | 其余（典型：只有 system + 首条 user） | `ide_mode_first_turn` | 全量历史 + 点「新建」 |

**为什么 2 必须在 3 之前**：压缩迁移后的首条消息只有 system + 1 条 user（无 assistant、userCount=1），
按消息形状会误判成"新会话首轮"再点新建——正是历史 Bug B；`resume_conversation_url` 显式声明绑定关系，
覆盖这种"有槽但形状不足"的续聊。`reason=ide_mode_resume` 即修复判据。

日志（`[incon_bridge] ide mode: …`）示例：

```
ide mode: turn=1 cont=True typed=10/4425 reason=ide_mode_resume
          resume=https://chat.deepseek.com/a/chat/s/e71af8ba-… hookfile=E:\…\incon_bridge\hooks.py
```

`typed=a/b`：`a` 实际打字字符数，`b` 全量字符数。续聊 = 只打尾部增量；首轮 = `a==b`。

---

## 6. 端到端流程

### 6.1 首条消息（建会话）

1. IDE 发首条 → 槽 MISS → 默认端点 → sidecar 判 `ide_mode_first_turn` → 网页点「新建」并全量打字。
2. 收尾 `x_uwa.conversation_url` 回传 → incontrol `recordUwaResponseExt` 绑定槽。

### 6.2 续聊（同一网页会话）

1. 槽命中 → 确定性路由 `/tab-url/<token>/v1/chat/completions` + 请求体带 `resume_conversation_url`。
2. sidecar 见 resume 且与会话 URL 一致 → `ide_mode_resume` → 把增量打回当前网页输入框。

### 6.3 手动「压缩对话」→ 迁移到新网页会话（核心联动）

```
GUI 点击「压缩对话」（CompactConversationButton）
  → core/util/conversationCompaction.ts 压缩历史，把摘要存进会话
  → 事件携带 systemPrompt + summary
      systemPrompt 优先取 rememberUwaSystemPrompt 缓存的最后一份 system（getUwaSystemPrompt(sessionId)）
  → bridge（conversationBridge.migrateAfterCompaction）
      POST /v1/chat/completions（model="default", stream=false）
      body 带 conversation_hint={reason:"compaction", prev_conversation_url} + force_new_conversation=true
  → sidecar 判 ide_mode_forced_new（trigger=compaction）→ 网页开「新会话」并把 系统提示词+摘要 打进首条
  → x_uwa 回传新会话 URL → incontrol 把槽从旧 URL 改绑到新 URL（每次压缩/切模型都更新）
```

修复 Bug A 的机制就落在这里：迁移首条 = **缓存系统提示词 + 摘要**，而不是只有摘要。

### 6.4 切换模型

与压缩迁移同构：`force_new_conversation=true`、`conversation_hint={reason:"model_switch"}`，
在网页开新会话并把上下文/系统提示词带过去，最后改绑槽。

---

## 7. 调试与验证速查

| 看什么 | 去哪看 | 特征 |
|---|---|---|
| 扩展决策 | VS Code 输出通道「uwa Sidecar」（落盘于 profile `logs/<ts>/window1/exthost/output_logging_*/1-uwa Sidecar.log`） | `[uwa-route] adapter slot url=…` |
| sidecar 分类 | sidecar stdout（同通道，前缀 `[uwa-sidecar]`）或 `resources/uwa-sidecar/logs/app.log` | `ide mode: turn=… reason=… resume=… hookfile=…` |
| 压缩/迁移 | 同通道 | `compaction completed … / [bridge] migrating reason=compaction … / migrated -> …` |
| 插件是否加载 | sidecar 启动段 | `[plugin_host] loaded plugin: incon_bridge`；`[incon_bridge] registered 2 钩子 (ide mode)` |
| sidecar 进程 | `Get-NetTCPConnection -LocalPort 8199` | 由扩展托管；Reload Window 带 `HISTORY_MODE=ide` 重启 |

一轮压缩迁移的验收标准：

1. 迁移请求 → `reason=ide_mode_forced_new` 且带 `trigger=compaction`；
2. 迁移后首条消息打进**新**网页会话，内容 = 系统提示词 + 摘要；
3. 随后的消息 → `reason=ide_mode_resume`，且**不新开**标签/对话。

---

## 8. 常见问题 / 注意事项

- **协议同步**：改了 `protocol.ts` 就必须同步 `protocol.py`（字段、枚举、版本号），反之亦然。
- **版本号**：`PROTOCOL_VERSION` 不兼容变更时递增；sidecar 与扩展版本不一致时以旧字段兼容运行。
- **不要依赖 contextvar 跨任务传参**：sidecar workflow 在独立任务/线程执行，见 §3.2。
- **测试前保证插件真的加载**：改 `hooks.py`/`api_patch.py` 后清 `__pycache__` 并 **Reload Window**
  让扩展带 `HISTORY_MODE=ide` 重启 sidecar；直接 kill sidecar 由内部监督重启可能丢环境变量，
  请求会退回 `mode=auto`（日志 `reason=first_turn`、无 `[incon_bridge]` 行）。
- **双树同步**：源码树 `vscode-1.136.1/…` 是开发位；运行中的 VS Code 产品位
  `VSCode-win32-x64/resources/app/…` 也要同步插件与打包产物（`npm run esbuild` 后复制
  `out/extension.js`）。改动前先确认当前测试实例到底加载哪棵树。
- **插件文件**：`api_patch.py`（中间件挂载）、`hooks.py`（钩子注册 + ext 通道 + 收尾 x_uwa）、
  `ide_mode.py`（分类逻辑）三件套要一起考虑。
- 保留备份文件以 `.bak-<stamp>` 形式放在同目录，便于回退。

---

## 9. 相关文件索引

| 关注点 | 文件 |
|---|---|
| 分类判定（resume/forced/cont/first） | `resources/uwa-sidecar/uwa-plugins/incon_bridge/ide_mode.py` |
| 钩子与 ext 通道 | `resources/uwa-sidecar/uwa-plugins/incon_bridge/hooks.py` |
| 中间件解析请求字段 | `resources/uwa-sidecar/uwa-plugins/incon_bridge/api_patch.py` |
| Python 侧协议 | `resources/uwa-sidecar/bridge/protocol.py` |
| TS 侧协议 | `extensions/incontrol/bridge/protocol.ts` |
| 槽位 / 指纹 / 系统提示词缓存 / trace | `extensions/incontrol/core/util/uwaRequestContext.ts` |
| 请求路由与 resume 注入 | `extensions/incontrol/core/llm/index.ts` |
| 压缩迁移（扩展侧） | `extensions/incontrol/bridge/*`、`core/util/conversationCompaction.ts` |
| 总览 | `BRIDGE.md` |
