# incon-mini ⇄ uwa-sidecar 会话一致性修复与需求评估总结

- **日期**：2026-09-08
- **范围**：`extensions/incontrol`（扩展侧）+ 只读定位 `resources/uwa-sidecar`（未改其 `app/`，仅有 `uwa-plugins/history_mode/hooks.py` 的既有改动）
- **云端仓库**：`https://github.com/s3hq4y/code-oss.git`（分支 master）
- **打包/运行位**：`VSCode-win32-x64\resources\app\extensions\incontrol`（产品树）

---

## 一、问题背景

多 IDE 会话（A/B）同时连接受控浏览器里的 deepseek 网页时，出现会话串台：A 的续聊/工具回流落到 B 的网页对话页，网页侧表现为「AI 不知道当前命令/上下文错乱」，并伴随多开标签页、URL 未切换等乱象。

## 二、根因链（经源码 + 实机日志双重证实）

1. **扩展侧算出了正确的定向目标，却从未真正发出**：
   - trace：`prepare -> http://127.0.0.1:8199/tab-url/{token}/v1/chat/completions`、`adapter target=…` 均正确。
   - sidecar 侧同一请求却始终以 `[CHAT:ENTRY]` → `API.TAB start (… -> tab #N, preset=<follow-tab/default>)` 形态到达 —— **没有一次 `URL 路由` 命中**。
   - sidecar `app/api/tab_routes.py` 证实：`/tab-url/{token}` 命中时的日志行就是 `开始 (URL 路由 {url} -> 标签页 #{N}…)`，故判据成立。
2. **断点**：deepseek/openai 类 provider 的 `useOpenAIAdapterFor` 含 `"streamChat"`，聊天请求走 `@incontrol/openai-adapters` 的 **OpenAI SDK 客户端**（baseURL 固定为构造时 apiBase）。扩展把 `uwaTargetUrl` 挂在 payload 非枚举字段上，**SDK 序列化时直接丢弃、永远请求 `{base}/chat/completions`**。OpenAI.ts 直连路径里 `uwaTargetUrl ?? _getEndpoint(...)` 的分支从未被执行。
3. **双标签现象的机制**：`ensureConversationPage` 发现槽内 URL 的标签不在池/不匹配时 `open-profile-url` 恢复/新开 —— 是定向失败的副作用，不是串台原因。

## 三、修复轮次

### R1（早前）
- `uwaSessionKey`（IDE 会话键）随请求传递；新增会话指纹 fp = 首条 user 摘要 + sessionKey；
- `/tab-url/{token}` 确定性路由构造与 `prepareUwaTargetUrl`。

### R2（本轮早期）
- `core/util/uwaRequestContext.ts`：`setUwaTrace/uwaTrace` 打点；
- `core/llm/index.ts`：`openAIAdapterStream` 分叉中补挂 `uwaSessionKey`（修复 spread 展开丢非枚举键）、adapter/slot/entry trace；
- `uwaConversationSync.ts`：listTabs/prepare/ensure 打点；
- `OpenAI.ts`、`bridgeActivation.ts`：trace 注入 uwa Sidecar 通道。

### R3 — 真正让 `/tab-url` 生效（本会话核心修复）
`core/llm/index.ts` 新增两个直发方法：
- `_uwaDirectChatStream`：`uwaTargetUrl` 存在时绕过 OpenAI SDK，用 `fetchwithRequestOptions` 裸 POST + 手写 SSE 解析（`data:` 帧 → JSON chunk），产出与 SDK 同构的 chunk，复用既有 `x_uwa` 帧记录/`fromChatCompletionChunk`/`citations` 循环；
- `_uwaDirectChatNonStream`：非流直发。
- 两个 adapter 方法入口改为 `uwaTargetUrl ? 直发 : 原 SDK` —— **普通消息（无定向需求）行为不变**；失败不再静默降级（HTTP 非 2xx 抛错可见）。

### R3.1 — Node 流兼容修复
- 实机报错 `response.body.getReader is not a function`：扩展宿主为 Node，`response.body` 是 async iterable 而非 Web ReadableStream。
- 新增 `_iterBodyChunks`：同时兼容 `getReader` 与 `Symbol.asyncIterator` 两种形态。

## 四、实机验证（验收证据）

sidecar 日志出现 **三次 `URL 路由` 命中**（修复前从未出现）：

```
19:41:41  #011  start (URL route https://chat.deepseek.com/ -> tab #4, preset=<follow-tab/default>)
19:42:22  #013  start (URL route … -> tab #4, …)
19:42:41  #014  start (URL route … -> tab #4, …)
```

同一时间扩展侧：`prepare -> …/tab-url/{token}…(page ready)` → `adapter target=…`。A/B 会话各自 fp 槽独立（A=`14f6b363…`→`724f180d…`、B=`c990f3ad…`→`e76d14e3…`），不再串页、无多余新标签。

> 命中 URL 显示 `https://chat.deepseek.com/` 为站点行为（新对话后页面停 `/`，会话由 sidecar 页内 typed 接管），不影响「请求精确落在本会话绑定页」验收。

## 五、产物指纹（SHA256）

| 项 | 值 |
|---|---|
| R3.1 bundle（源码树 = 产品树一致） | `26459F337A80345F252501BC798979AEF46ED13888F69D93EB5CCD1015FDDFA6` @ 15,596,024 B |
| R2 bundle（回滚参照） | `6650750C95CC3CCED708A723A500D7FCF07D70CA8CC68826E94BC4FDE7FBE10B` @ 15,592,792 B |
| 产品树备份 | `VSCode-win32-x64\resources\app\extensions\incontrol\out\extension.js.bak-r2-20260908` |

## 六、需求 0–4 完成度（源码评估，代码位置可查）

| # | 需求 | 扩展侧代码状态 | 完成度 | 关键位置 |
|---|---|---|---|---|
| 1 | 连接 uwa 创建对话后记录聊天 URL（会话一致性） | ✅ 已实现 + 本轮实测 | **高** | `core/llm/index.ts` `recordUwaResponseExt`；`core/util/uwaRequestContext.ts` 会话槽 |
| 2 | 压缩对话 → 复制压缩内容 → 发到新网页对话（系统提示词+摘要）→ 更新 URL/token | ✅ 链路完整 | **中高（未端到端实测）** | GUI：`gui/src/components/StepContainer/ResponseActions.tsx`（压缩按钮，上下文≥60% 在最后一条 AI 回复旁显示）、`ContextStatus.tsx`；core：`core/util/conversationCompaction.ts` → `compactionEvents.ts` `onCompactionCompleted`；bridge：`bridgeActivation.ts`（自动复制剪贴板 + `markNextRequest({force_new_conversation, system_prompt_mode:'always', conversation_hint})`）→ `bridgeTriggers.ts` `onCompactionComplete` → `conversationBridge.ts` `migrate` |
| 3 | 切模型 → 打包历史 token + 系统提示词 → 发新窗口 → 更新 URL | ⚠️ 迁移链路齐全（`onModelSwitched`、`migrateOnModelSwitch`、`resolveModelRoute`、`gui/.../updateSelectedModelByRole.ts`），**自动触发未端到端验证** | **低-中** | `compactionEvents.ts`；`bridgeActivation.ts` L659-695；`conversationBridge.ts` `migrateOnModelSwitch` |
| 4 | 自动检测 uwa 网页并自动更新模型列表 | ⚠️ 网页轮询（15s）+ 模型同步命令已有（`startPagePolling`/`syncUwaModelsCommand`/`uwaPages.ts`/`uwaModelOverlay.ts`），**同步为手动命令触发，非全自动** | **中** | `bridge/bridgeActivation.ts` L197/247；`bridge/uwaPages.ts`；`core/util/uwaModelOverlay.ts` |
| 0 | sidecar 保持/新增「智能发最后一条」新模式 | ⚠️ 未做新模式；`history_mode:'ide'` 由扩展注入（`bridgeActivation.ts:424`）；sidecar `uwa-plugins/history_mode/hooks.py` 有既有改动（未在本轮验证行为） | **低** | 未动 `resources\uwa-sidecar\app\` |

### 备注（跨条风险）
- 需求 2/3 的迁移走 bridge **全局单例 binding**（状态栏绑定），非按会话 fp 槽；A/B 多会话并行时若在非当前绑定会话压缩，迁移目标可能错位 —— 建议后续统一到 fp 槽。
- R3.1 落地前 binding 不稳定正是压缩/切模型迁移不可用的隐藏原因；现路由已修，值得端到端实测一次「压缩 → 迁移」全流程。
- 受控浏览器 debug 口偶发失联（watchdog `port unreachable`）后 sidecar 曾异常退出（退出码 1）一次；重启 sidecar 后标签重扫，绑定需重新建立。

## 七、本会话改动文件清单（源码树 `extensions/incontrol`）

- `core/util/uwaRequestContext.ts`（R2：trace/上下文）
- `core/util/uwaConversationSync.ts`（R2：listTabs/prepare/ensure 打点）
- `core/llm/index.ts`（R2 补挂 sessionKey；**R3/R3.1 直发核心**）
- `core/llm/llms/OpenAI.ts`（R2 trace；直连路径既有 `uwaTargetUrl ?? _getEndpoint`）
- `bridge/bridgeActivation.ts`（R2 trace 注入；需求 2/3/4 订阅与命令）
- 其他仓库内需求实现：`bridge/conversationBridge.ts`、`bridge/uwaPages.ts`、`core/util/historyPacker.ts`、`core/util/uwaModelOverlay.ts`、`core/util/conversationCompaction.ts`、`core/util/compactionEvents.ts`、`gui/.../updateSelectedModelByRole.ts`、`resources/uwa-sidecar/uwa-plugins/history_mode/hooks.py` 等

## 八、后续建议

1. 端到端实测：切回 A 会话 → 发长对话使上下文 ≥60% → 点压缩按钮 → 确认摘要复制 + 新网页对话收到系统提示词+摘要 + binding URL 更新。
2. 需求 3：在 GUI 模型切换处接通 `onModelSwitched.emit`（现仅有链路无触发验证），并实测切换后新窗口收到打包历史。
3. 统一迁移目标为会话 fp 槽（替代全局 binding）。
4. 若需「智能发最后一条」等 sidecar 行为定制，需放开 `resources\uwa-sidecar\app\` 只读约束，另行排期。
