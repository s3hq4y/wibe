# UWA 图片传输故障排查存档（2026-09-18）

> 任务：定位 incontrol 扩展 ↔ uwa-sidecar 链路「图片无法传输到网页」的原因。
> 工作区：`E:\Tools\IDE-Workspace\bridges\code-oss\vscode-1.136.1`
> 定位线索：抓取 `resources/win32/code.ico`

---

## 一、结论速览

**主因不在 incontrol 扩展侧，而在 sidecar 的图片格式白名单。**
图片在粘贴/上传到网页**之前**就被 `uwa-sidecar/app/utils/image_handler.py` 静默丢弃，导致网页端从未收到任何上传动作，且全程无报错。

已用 `code.ico` **实测复现**。

---

## 二、incontrol 侧：两处既有修复已验证有效（非本次根因）

逐环读源码验证（非依赖摘要）：

| 环节 | 位置 | 状态 |
|---|---|---|
| 工具产出 `ContextItem.imageUrl` data URL | `core/tools/implementations/fetchImage.ts` | ✅ |
| `capabilities: { uploadImage: true }` | `core/util/uwaModelOverlay.ts` | ✅ |
| 该值真正生效（配置装配时调用） | `core/config/load.ts:809` → `applyUwaModelsToSerialized(withShared)` | ✅ 已接线 |
| → `LLMOptions.capabilities` → `this.capabilities` | `core/llm/index.ts:281` | ✅ |
| → `modelSupportsImages()` 首查 `capabilities.uploadImage` | `core/llm/autodetect.ts:165` | ✅ 返回 true，不再剥离图片 |
| 原生分支图片提升 | `gui/src/redux/util/constructMessages.ts` | ✅ |
| system-tools 分支图片提升 | 同上 | ✅ |
| `imageUrl` → `image_url` 转换 | `core/llm/openaiTypeConverters.ts:192` | ✅ |
| 历史图片过滤（保留最新一轮） | `core/util/uwaImages.ts` `prepareUwaChatMessages` | ✅ |
| 侧信道转发 | `gui/src/redux/thunks/streamResponseAfterToolCall.ts` | ✅ |
| 工具注册链 | `builtIn.ts` / `definitions/index.ts` / `tools/index.ts` / `callTool.ts` | ✅ |

**结论：编译期剥离图片的问题已被上述修复解决。**

---

## 三、真正根因：sidecar 格式白名单（含实测证据）

### 3.1 实测格式矩阵

按 sidecar 原始逻辑执行（未改任何代码）：

```
extension path  发出的 data URL            sidecar 结果
a.png           data:image/png;...        PASS
a.jpg           data:image/jpeg;...       PASS
a.gif           data:image/gif;...        PASS
a.webp          data:image/webp;...       PASS
a.bmp           data:image/bmp;...        PASS
a.svg           data:image/svg+xml;...    DROP  <- 正则无法匹配 'svg+xml'
code.ico        data:image/png;...        DROP  <- PIL 报 ICO，不在映射表
```

### 3.2 `code.ico` 逐步复现

```
code.ico size: 96412 bytes
  -> EXT_MIME 无 .ico -> mime=undefined -> 谎报 data:image/png;base64,<ICO字节>
  -> 正则 data:image/(\w+);base64,... 匹配通过（png 是 \w+）
  -> .png 属于 SUPPORTED_FORMATS 通过
  -> PIL 实际格式 = ICO
  -> _PIL_FORMAT_EXTENSIONS 查 ICO -> None
  -> raise unsupported_image_format:ICO
  -> DROPPED
```

### 3.3 缺陷 A —— `.ico` 被「误标 + 白名单拒绝」双重打击

incontrol `core/tools/implementations/fetchImage.ts`：

```ts
const EXT_MIME = { ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg",
                   ".gif":"image/gif", ".webp":"image/webp", ".bmp":"image/bmp",
                   ".svg":"image/svg+xml" };   // <- 没有 .ico
...
const resolvedMime = mime ?? "image/png";       // <- .ico 落到这里，谎报成 png
```

sidecar `app/utils/image_handler.py`：

```python
_PIL_FORMAT_EXTENSIONS = {'JPEG':'.jpg','PNG':'.png','GIF':'.gif','WEBP':'.webp','BMP':'.bmp'}  # <- 没有 ICO
...
detected_ext = _PIL_FORMAT_EXTENSIONS.get(str(img.format or '').upper())
if not detected_ext:
    raise ValueError(f"unsupported_image_format:{img.format}")   # <- ICO 在此抛错
```

### 3.4 缺陷 B —— `.svg` 被正则直接拒掉

```python
# _save_base64_image
match = re.match(r'data:image/(\w+);base64,(.+)', data_uri)   # \w 不含 '+'
```

`svg+xml` 含 `+` -> **regex 直接失败**。
而 incontrol 工具文档明确写着 *Supported formats: png, jpeg, gif, webp, bmp, svg* —— **工具宣称支持 svg，sidecar 完全不支持。**

### 3.5 为何表现为「完全看不到图」且无报错

丢弃是**静默**的：

```
_validate_image_bytes 仅 logger.warning（无异常上抛）
  -> extract_images_from_messages 返回 []
  -> workflow: user_images = []
  -> paste_images([]) 直接 return True（视作"成功"）
  -> 网页端从未收到任何粘贴/上传动作
```

请求本身不报错；`_validate_image_inputs` 的 400 也不会触发（data URL 完整，`base64,` 后有数据，`has_any_valid_image` 判为 True）。

### 3.6 影响范围

一切 `EXT_MIME` 未列出的扩展名（`.tiff` / `.avif` / `.heic` / `.apng` 等）都会被谎报成 `image/png`，再被 PIL 白名单拒掉。

---

## 四、修复清单（已备好，未应用）

| # | 文件 | 修改 |
|---|---|---|
| 1 | `image_handler.py` `_save_base64_image` | 正则改为 `r'data:image/([\w.+-]+);base64,(.+)'` |
| 2 | `image_handler.py` `_PIL_FORMAT_EXTENSIONS` | 补 `'ICO': '.ico'`；`SUPPORTED_FORMATS` 补 `.ico`（SVG 需矢量特判，PIL 不解析） |
| 3 | `fetchImage.ts` `EXT_MIME` | 补 `".ico": "image/x-icon"`；未识别扩展名改为**显式报错**，不再静默 fallback 到 png |
| 4 | `_validate_image_bytes` | 失败原因回传到工具结果，不再静默吞掉 |

---

## 五、残余疑点（必须指出）

**PNG / JPEG / GIF / WEBP / BMP 实测全部 PASS。**

因此上述缺陷可完美解释：
- `.ico` 测试 -> 必然失败
- `.svg` 测试 -> 必然失败
- 任何 `EXT_MIME` 未列出的扩展名 -> 失败

但**不能解释**「普通 PNG 截图也传不过去」。若实际复现场景为 PNG，则还存在**第二个未定位的原因**，可能在尚未做端到端实测的环节 —— 各链路均为逐个读代码验证，**未抓取实际发往 sidecar 的 HTTP 请求体**来确认 PNG data URL 确实出现在 `body.messages` 中。

### 建议下一步
1. 确认实际失败时使用的图片格式。若是 `.ico` / `.svg`，根因已闭环。
2. 若是 PNG，抓取实际请求体做端到端验证。可用日志：`app/api/chat.py` 中 `[DIAG] 接收到的原始请求` 与 `[IMAGE_FLOW_DIAG]`。

---

## 六、部署态核查

- 部署态 sidecar 实际路径为 `E:\Tools\Wibe\resources\app\resources\uwa-sidecar\`（**不是** `resources\uwa-sidecar`）。
- 源码与部署态 `image_handler.py` hash 不同（`FE503C93...` vs `B4042BB5...`），但**两处格式缺陷均存在**。
- 部署态扩展包已验证含两处修复：
  - `out/extension.js`（6,455,434 B）：`uploadImage` × 7、`fetch_image` × 4
  - `gui/assets/index.js`（3,889,699 B）：两条提示串各 × 1、`imageUrl` × 8

---

## 七、附带发现（非主因，建议复核）

`prepareUwaChatMessages` 存在边界问题：若图片 user 消息之后紧跟**第二次**工具调用，`hasAssistantResponse` 会因 `role:"tool"` 判为 true，导致该图片被当作历史图剥掉（多轮连续工具调用场景）。

---

## 八、其他事实

- `fetch_image` 工具本身属**未提交改动**：`core/tools/definitions/fetchImage.ts`、`core/tools/implementations/fetchImage.ts`、`builtIn.ts`、`callTool.ts`、`core/tools/index.ts`、`definitions/index.ts`、`toolUsageDocs.ts`、`toolUsageOneLiners.ts`、`core/index.d.ts`、`core/config/types.ts`、`core/util/messageContent.ts`
- 本次改动文件：`core/util/uwaModelOverlay.ts`、`gui/src/redux/util/constructMessages.ts`
- `media/assets`（111 文件）与 `gui/assets`（56 文件）为历史遗留差异；运行时 bundle 只引用 `gui/assets`。
