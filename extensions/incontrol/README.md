# incontrol

A private, self-contained VS Code agent: chat, agent mode, inline edit and tab
autocomplete against models and config you control. This is a fork of
[Continue](https://github.com/continuedev/continue) `1.3.40`, rebranded and cut
loose from the upstream services, release tooling and monorepo layout.

Extension id: `incontrol.incontrol` &nbsp;·&nbsp; config dir: `~/.incontrol`

## What differs from upstream Continue

| Area | Upstream | Here |
| --- | --- | --- |
| Extension id / commands / settings | `Continue.continue`, `continue.*` | `incontrol.incontrol`, `incontrol.*` |
| Global config dir | `~/.continue` | `~/.incontrol` (`INCONTROL_GLOBAL_DIR` env) |
| rc file | `.continuerc.json` | `.incontrolrc.json` (legacy file still read) |
| Repo layout | monorepo, extension lives in `extensions/vscode` | single folder: `core/`, `gui/`, `packages/` inside the extension root |
| Upstream services | hub, license, update/version gates, telemetry endpoint | none - no request ever goes to `continuedev` |
| Telemetry | on unless disabled | off unless enabled (see [Privacy](#privacy)) |
| Logo / icon | Continue mark | own mark (chevrons + caret) |
| System prompt | always sent, built in | opt-in per message, defaults to the tool template below |
| Model setup | "Add model" form backed by a hand-written catalogue of 100+ providers (`packages/llm-info`, `gui/src/pages/AddNewModel`) | none - models are declared in `config.yaml`; the Models tab and the model picker open that file |
| Codebase / docs indexing | `@codebase`, `@folder`, `@docs` backed by LanceDB, a local embedding model (transformers.js + onnxruntime) and a Chromium/cheerio crawler | removed - `@url` (jsdom + readability) still fetches single pages; context comes from `@file`, `@folder` tree, `@code`, search and MCP |
| Database context | `@postgres`, `@database` (pg, mysql2, mssql via dbinfoz) | removed |
| Next Edit preview | code rendered to an SVG image by shiki (all ~60 themes + 17 grammars bundled, jsdom post-processing) | native editor decorations: plain text in the editor font, colours from the active theme (`ThemeColor`); no highlighter shipped |
| tree-sitter grammars | 36 wasm grammars | 17 mainstream languages (C/C++, TS/JS, Python, Go, Rust, Java, PHP, Lua, Elm, Bash, JSON, TOML, HTML, CSS, ...) |
| ripgrep | own `rg` binary in the VSIX (~4.7 MB) | not bundled - `@search` reuses the ripgrep that ships with VS Code (`@vscode/ripgrep-universal`), falling back to `rg` on PATH |

`~/.incontrol` is created on first start. If a `~/.continue` directory exists,
the small hand-written files (`config.yaml`, `config.json`, `prompts/`,
`rules/`, ...) are copied over once; indexes and installed `node_modules` are
deliberately **not** copied. The old directory is left untouched, so the
previous extension keeps working.

## Building the VSIX

```bash
npm install
npm run package -- --target win32-x64      # -> build/incontrol-win32-x64-0.1.0.vsix
code --install-extension build/incontrol-win32-x64-0.1.0.vsix
```

Install dependencies **only at the root**. `core/` is bundled from the root
`node_modules` (it is linked there as `node_modules/core`); do not run
`npm install` inside `core/`. A standalone install there makes esbuild resolve
core's imports from `core/node_modules` first, so every dependency shared with
the root (zod, the AWS/Bedrock SDK, yaml, ws, ...) lands in `extension.js`
twice - about 2.5 MB of dead weight. Both build scripts abort when they find
`core/node_modules/.package-lock.json`; delete `core/node_modules` to fix it.

Install dependencies **only at the root**. `core/` is bundled from the root
`node_modules` (it is linked there as `node_modules/core`); do not run
`npm install` inside `core/`. A populated `core/node_modules` makes esbuild
resolve core's imports from that tree first, so every dependency shared with
the root (zod, the AWS/Bedrock SDK, yaml, ws, ...) ends up in `extension.js`
twice - about 2.5 MB of dead weight. `scripts/prepackage-standalone.js`
refuses to package while that directory exists.

`npm run package` runs `scripts/prepackage-standalone.js` first: it builds the
GUI, bundles `core`, copies the sqlite3 native binding and the
tree-sitter grammars, generates `config_schema.json` /
`incontrol_rc_schema.json` / `config-yaml-schema.json`, and verifies every file
the package needs. Nothing else is downloaded: the local embedding model,
LanceDB and onnxruntime are gone together with codebase indexing.

Useful toggles:

| Env / flag | Effect |
| --- | --- |
| `SKIP_GUI_BUILD=true` | reuse `gui/dist`, don't run vite |
| `SKIP_DOWNLOADS=true` | never fetch the sqlite3 prebuilt binding |
| `SKIP_VALIDATE=true` | skip the "all files present" check |
| `--target win32-x64` | platform-specific package; vsce inserts the target before the version |

Type checks: `npm run tsc:check` in the root and in `gui/`.

## Manual system prompt

This build does not attach a system message to your chats unless you ask for it.

1. Put the prompt you want in **Settings → General → Manual System Prompt**
   (stored in `config.yaml` as `ui.manualSystemMessage`, saved globally).
2. In chat, click the document icon in the input toolbar. The next message is
   sent with that system prompt; afterwards the toggle disarms itself, so it is
   never injected into later requests.

If the box is empty, the toolbar sends the built-in template from
`gui/src/util/systemPromptTemplate.ts` instead. It follows the way tools are
actually gated in `core/tools/index.ts`, in three tiers:

1. **Always available** - `read_file`, `read_currently_open_file`, `view_diff`,
   `ls`, `grep_search` (not offered in remote/SSH windows), `file_glob_search`,
   `create_new_file`, `run_terminal_command`, `fetch_url_content`, `search_web`,
   `request_rule`, `create_rule_block`, `read_skill`
2. **Only when `experimental.enableExperimentalTools` is on** - `read_file_range`,
   `view_repo_map`, `view_subdirectory`, `codebase`. These are added on top of
   tier 1, never instead of it, and the template says to fall back to
   `grep_search` or `read_file` when unsure.
3. **The edit tool, chosen by the model** - recommended agent models (`gpt-4.1`,
   `gpt-5` and up, `o1`-`o4`, `codex`, `claude sonnet 3.7` / `opus 4` and up,
   `gemini 2.5 pro`, `deepseek r1`, `grok-code`) get `multi_edit` and nothing
   else; every other model gets `edit_existing_file` plus
   `single_find_and_replace` and no `multi_edit`. The template states that the
   two sets are mutually exclusive so a model never calls a tool it was not given.

It also spells out the calling syntax used when tools are not native: one fenced
`tool` block per reply, `TOOL_NAME:` on the first line, then one `BEGIN_ARG:` /
value / `END_ARG` line group per argument, argument values encoded as JSON, and
nothing after the closing fence - the grammar implemented in
`core/tools/systemMessageTools/toolCodeblocks/`. Models with native tool support
keep their usual schemas and are told not to write such blocks, so the two modes
never mix in one reply; in the other mode the request additionally carries the
auto-generated `<tool_use_instructions>` block, which stays authoritative for
argument names.

The template also directs the model to the bundled "tool-usage" skill
(`~/.incontrol/skills/tool-usage/SKILL.md`, generated from
`core/tools/toolUsageGuides.ts` + per-tool descriptions). It holds categorized
usage documentation for every built-in tool - reading, search, editing
formats, terminal, web, rules - which the model reads via
`read_skill("tool-usage")`, or via `get_tool_usage` for a single tool when the
`experimental.slimToolDescriptions` experiment is on. The skill re-seeds
itself when its content version changes (delete it and it stays deleted).

Alongside the tools the template carries the editor habits that matter here:
read a file before editing it, copy `old_string` verbatim, one edit call at a
time, and run the narrowest command that proves the change. "Insert tool
template" in settings drops the whole text into the box so you can edit it.

## Models

There is no provider picker and no built-in model catalogue. Every model is a
`models:` entry in `config.yaml`, exactly as documented for Continue's YAML
format; the **Models** settings tab, the `+` button and the "Add model" entry in
the model dropdown all just open that file:

```yaml
models:
  - name: GPT-4o
    provider: openai            # any provider class in core/llm/llms
    model: gpt-4o
    apiBase: https://api.openai.com/v1
    apiKey: ${{ secrets.OPENAI_API_KEY }}
    roles: [chat, edit, apply]
    defaultCompletionOptions:
      contextLength: 128000     # optional; default 32768 when omitted
      maxTokens: 8192           # optional; default 4096 when omitted
```

Because the catalogue is gone, `contextLength` / `maxTokens` are no longer
auto-detected from the model name: set them in `config.yaml` when the defaults
above do not fit (a few provider classes such as Ollama still ask the server).

## Config files

```
~/.incontrol/config.yaml          # models, rules, MCP servers, context providers
~/.incontrol/.incontrolrc.json    # per-config-dir overrides (merged on top of config.json)
~/.incontrol/.env                 # ${secrets.*} used by MCP servers
<project>/.incontrol/config.yaml  # project-local assistant (also reads .continue/)
<project>/.incontrolignore        # files hidden from @file/@folder/search (legacy .continueignore still read)
```

Project-local `.continue/` folders, `.continueignore` and `.continuerules`
files are still read, so assistants written for Continue or the JetBrains
plugins keep working.

## Renaming after a re-sync

Identity decisions live in one place:

```bash
node scripts/rename-identity.js --dry-run   # counts + leftover report
node scripts/rename-identity.js             # apply
```

It rewrites `package.json` through the parsed manifest (identity, all command /
setting / view / submenu ids, `when` clauses, json-validation globs, titles) with
self-checks that fail if a `when` clause points at a view that does not exist or
any stale `continue.` id survives; renames `EXTENSION_NAME`, the workspace
config key and the global directory; widens the config-watcher predicates so hot
reload keeps working for both `.continue` and `.incontrol`; and fixes the GUI
copy. It is idempotent, so re-running it is harmless.

Beyond that, the codebase itself carries no `continue` branding any more:
internal TypeScript names (`IncontrolConfig`, `IncontrolRcJson`,
`getIncontrolGlobalPath`, `src/IncontrolGUIWebviewViewProvider.ts`, ...), the
webview message names, the local package scope (`@incontrol/config-yaml`,
`@incontrol/fetch`, ... - built from `packages/`, never published) and the
user-visible strings were cleaned in a one-shot codemod. Deliberately **kept**:

- `continueAfterToolRejection`, a user-facing config key;
- `docs.continue.dev` links, which still document this exact config format;
- `media/continue_tutorial.py`, used by the autocomplete tutorial;
- the legacy compatibility aliases (`.continue` dirs, `.continuerc.json`,
  `.continuerules`, `.continueignore`, `CONTINUE_GLOBAL_DIR` env var) that keep
  pre-rebrand user setups working.

## Privacy

Nothing phones home. `allowAnonymousTelemetry` and the `incontrol.telemetryEnabled`
editor setting both default to `false`, and there is no upstream endpoint to send
to in the first place; the VS Code telemetry setting is additionally honoured.
Network traffic only goes to what you configure yourself: model providers, MCP
servers and the URLs you explicitly reference with `@url`.

## License

Apache-2.0, inherited from upstream Continue. See `LICENSE`.
