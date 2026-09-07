# incontrol — docs for LLM agents

This folder holds reference documentation meant to be read by an LLM (the
incontrol agent itself, or an external coding agent driving the repo). Each
file covers one area and mirrors what the extension actually ships, so it can
be handed to a model verbatim or used as source material when writing prompts,
rules or skills.

| File | Contents |
| --- | --- |
| [`system.md`](system.md) | What incontrol is, the runtime environment and the rules the agent must follow. |
| [`prompts.md`](prompts.md) | The default prompts the extension sends: the manual system-prompt template and the goal-nudge message. |
| [`tools.md`](tools.md) | Built-in tool usage: availability tiers, the system-message call grammar, edit tools and per-tool guidance. |
| [`config.md`](config.md) | Config file layout (`~/.incontrol/...`) and the settings that affect agent behaviour, including goal tracking. |

## Where the source of truth lives

These docs are derived from the code. When something changes, update the docs
together with the code:

- Default system prompt → `gui/src/util/systemPromptTemplate.ts`
- Goal nudge message + max nudges → `gui/src/redux/thunks/streamNormalInput.ts`
  (default text and cap) and `core/config/types.ts`
  (`experimental.maxGoalNudges` / `experimental.goalNudgeMessage`)
- Tool usage guides → `core/tools/toolUsageGuides.ts` (seeded as the
  `tool-usage` skill at `~/.incontrol/skills/tool-usage/SKILL.md`)
- Tool tiers / gating → `core/tools/index.ts`; argument schemas →
  `core/tools/definitions/*.ts`
- System-message call grammar → `core/tools/systemMessageTools/toolCodeblocks/`
- Code-presentation instructions → `core/llm/defaultSystemMessages.ts`
- Config files → `core/config/load.ts`, `core/config/yaml/*`
- Agent guidance shipped inside the package → `build/SYSTEM.MD`
