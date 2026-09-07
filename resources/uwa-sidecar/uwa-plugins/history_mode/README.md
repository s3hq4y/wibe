# history_mode 插件

多轮对话历史模式（`auto` / `full` / `last`）+ 会话亲和续聊 + `skip_on_continuation` 续聊跳过。

## 三种模式

| 模式 | 行为 |
|---|---|
| `auto` | 标签页已持有同一段对话时，只补发新增轮次并跳过"新建对话"；对不上则整段重放（默认） |
| `full` | 每次把完整历史打进输入框（无状态，跨刷新最稳；= 上游原行为） |
| `last` | 永远只发最后一句话（最省 token） |

## 配置方式（任选）

1. **请求参数**：`history_mode`（OpenAI/Anthropic 兼容接口均支持，见壳补丁）；
2. **环境变量**：`HISTORY_MODE`；
3. **配置**：`config/browser_config.json` 的 `HISTORY_MODE`（由 `merge_patches.py` 写入，默认 `last`）；
4. **前端**：设置页"对话复用与历史模式"下拉框。

优先级：请求参数 > 环境变量/配置 > `auto`。

## 数据补丁

- `site_patches.json`：
  - 新增 `www.deepseek.com` 站点；
  - 给 `chat.deepseek.com` 三个预设的 `CLICK 专家` 步骤打 `skip_on_continuation` 标记（续聊时该按钮不再渲染，跳过以免"元素未找到"）；
  - 给 `gemini.google.com` 四个预设（`3.7flash` / `3.1 pro` / `3.5 flash lite` / `3.7 非隐私对话`）的
    `临时对话按钮`、`点击模型选择`、`选择模型` 步骤打 `skip_on_continuation`（续聊时临时对话开关与模型切换不再渲染/不可用，跳过）。
- `config_patch.json`：`HISTORY_MODE=last`；`CONVERSATION_TIMEOUT_THRESHOLD=1200`、
  `TEXT_INPUT_CHUNK_SIZE=999999` 为原 fork 偏好值，可按需删改。

用 `python uwa-plugins/history_mode/merge_patches.py` 合并进 `config/`（自动备份 `.bak_plugin`）。
