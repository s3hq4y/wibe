# Configuration

## Config files

```
~/.incontrol/config.yaml          # models, rules, MCP servers, context providers
~/.incontrol/.incontrolrc.json    # per-config-dir overrides (merged on top of config.json)
~/.incontrol/.env                 # ${secrets.*} used by MCP servers
<project>/.incontrol/config.yaml  # project-local assistant (also reads .continue/)
<project>/.incontrolignore        # index exclusions (legacy .continueignore still read)
```

`~/.incontrol` is created on first start (override with `INCONTROL_GLOBAL_DIR`).
If a `~/.continue` directory exists, the small hand-written files
(`config.yaml`, `config.json`, `prompts/`, `rules/`, ...) are copied over once;
multi-GB indexes and installed `node_modules` are not. The old directory is
left untouched.

Project-local `.continue/` folders, `.continueignore` and `.continuerules`
files are still read, so assistants written for Continue or the JetBrains
plugins keep working.

## Models

Models are hand-written `models:` entries in `config.yaml`; there is no
"Add model" form or provider catalogue. The Models settings tab, the `+`
button and the dropdown's "Add model" entry open the active config file.

| Key | Default | Meaning |
| --- | --- | --- |
| `provider` | - | Provider class name (`openai`, `anthropic`, `ollama`, `gemini`, `openrouter`, ... - see `core/llm/llms`). Any OpenAI-compatible endpoint works with `provider: openai` + `apiBase`. |
| `model` | - | Model id sent to the provider. |
| `apiBase` / `apiKey` | provider default / - | Endpoint and credential; `${{ secrets.NAME }}` reads `~/.incontrol/.env`. |
| `roles` | `[chat, summarize, apply, edit]` | Which roles the model may fill; add `autocomplete`, `embed`, `rerank` or `subagent` explicitly. |
| `defaultCompletionOptions.contextLength` | `32768` | Not auto-detected from the model name any more - set it for large-context models. |
| `defaultCompletionOptions.maxTokens` | `4096` | Max output tokens per response. |

## Settings that affect agent behaviour

These keys live in `config.yaml` (or the settings page, which writes to the
same place through `config/updateSharedConfig`).

### Goal tracking (`experimental`)

| Key | Default | Meaning |
| --- | --- | --- |
| `experimental.maxGoalNudges` | `5` | How many times the agent may re-send the session goal when the model ends a turn without calling a tool. `0` disables the auto-continue behaviour. The nudge count is a hard brake: without it a model that keeps replying in plain text would loop forever. |
| `experimental.goalNudgeMessage` | built-in text | Custom nudge message. `{{goal}}` is replaced with the goal text. Falls back to the built-in message when omitted (see [`prompts.md`](prompts.md)). |

Both are editable on the settings page (**Experimental → Goal Nudge Count** /
**Goal Nudge Message**). A goal is set with the `/goal` command and ends only
when the agent calls `mark_goal_complete(summary="...")`.

### Tool availability (`experimental`)

| Key | Default | Meaning |
| --- | --- | --- |
| `experimental.enableExperimentalTools` | `false` | Adds `read_file_range` (and other experimental tools) to the always-available tier. |
| `experimental.onlyUseSystemMessageTools` | `false` | Disable native tool calling; tools are driven through the system-message ````tool```` block grammar. |
| `experimental.slimToolDescriptions` | `false` | Tools are listed as one-line summaries in the prompt; the model calls `get_tool_usage` for full usage docs. |

### Other experimental keys

| Key | Meaning |
| --- | --- |
| `experimental.useCurrentFileAsContext` | Add the currently open file as context in every new conversation. |
| `experimental.promptPath` | Path to workspace prompts. |
| `experimental.readResponseTTS` | Read responses aloud (TTS). |
| `experimental.enableStaticContextualization` | Static contextualization experiment. |

### UI (`ui`)

| Key | Meaning |
| --- | --- |
| `ui.manualSystemMessage` | Saved manual system prompt. Empty → the built-in template is used when the prompt is armed (see [`prompts.md`](prompts.md)). |
| `ui.showSessionTabs` | Tabs above the chat. |
| `ui.continueAfterToolRejection` | Keep streaming after a tool call is rejected. |
| `ui.codeWrap`, `ui.displayRawMarkdown`, `ui.showChatScrollbar`, `ui.fontSize`, `ui.codeBlockToolbarPosition` | Editor/chat presentation. |

### Autocomplete (`tabAutocompleteOptions`)

| Key | Meaning |
| --- | --- |
| `useCache` | Reuse the autocomplete cache. |
| `multilineCompletions` | `"always"`, `"never"` or `"auto"`. |
| `disableInFiles` | Comma-separated glob patterns where autocomplete is off. |
| `modelTimeout` / `debounceDelay` | Autocomplete timing (ms). |

### Top-level

| Key | Default | Meaning |
| --- | --- | --- |
| `allowAnonymousTelemetry` | `false` | Telemetry is off unless enabled; there is no upstream endpoint anyway. |
| `disableIndexing` | `false` | Legacy switch; codebase indexing has been removed, the key is accepted and ignored. |
| `disableSessionTitles` | `false` | Do not auto-title sessions. |

## Where the keys are defined

- TypeScript types: `core/config/types.ts` (config) and
  `core/config/sharedConfig.ts` (the subset the settings page edits, via
  `modifyAnyConfigWithSharedConfig`).
- JSON Schema for `config.json`/`config.yaml`: `config_schema.json`,
  `config-yaml-schema.json` (generated by `scripts/prepackage-standalone.js`).
- YAML loading: `core/config/yaml/loadYaml.ts`.
