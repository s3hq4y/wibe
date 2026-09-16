/**
 * Hand-written usage documentation for the built-in tools (terminal,
 * multi-edit and goal-complete). This is the body of the bundled "tool-usage"
 * skill that gets
 * seeded into ~/.incontrol/skills/tool-usage/SKILL.md (see
 * core/config/markdown/loadMarkdownSkills.ts) and is meant to be read by the
 * model via read_skill, so it must stay accurate with respect to
 * core/tools/index.ts (tool list) and core/tools/definitions/*.ts (argument
 * names and behaviour).
 *
 * Bump BUNDLED_TOOL_USAGE_VERSION in loadMarkdownSkills.ts whenever the text
 * below changes so existing installs re-seed the skill file.
 */

export interface ToolUsageGuide {
  /** Heading shown in the skill, e.g. "Reading files". */
  title: string;
  /** Markdown body of the guide. */
  body: string;
}

export function getToolUsageGuides(): ToolUsageGuide[] {
  return [
    {
      title: "Editing files",
      body: `Tool: \`multi_edit (filepath, edits)\`.

- Call the tool with a relative path (\`/\`-separated) and an array of edits \`{ old_string, new_string, replace_all? }\`.
- \`old_string\` must match the file verbatim, whitespace and indentation included - copy it from the file's current contents, not from memory.
- Edits are applied in order, each on the result of the previous one. Put every change to a file into a single \`multi_edit\` call; the tool cannot be called in parallel with anything, including itself.
- All edits must validate or nothing is applied - never leave the file in a broken state.
- Use \`replace_all: true\` to rename a token across the file; without it, a non-unique \`old_string\` is an error.
- After editing, run the narrowest command that proves the change rather than assuming success.`,
    },
    {
      title: "Goal completion",
      body: `Tool: \`mark_goal_complete (summary)\`.

- Only available while a session goal is active (set with the \`/goal\` slash command). It is the ONLY way to stop goal tracking - saying the goal is complete in plain text does not stop the nudge loop.
- Call it once the goal has genuinely been met and verified, passing a one-sentence \`summary\` of how it was achieved.
- Do not call it speculatively or for partial progress; keep working (and use \`run_terminal_command\`/\`multi_edit\`) until the goal is truly done.`,
    },
    {
      title: "Terminal",
      body: `Tool: \`run_terminal_command (command, waitForCompletion?)\`.

- Runs in the IDE shell on the user's machine, so pick commands for the user's platform and shell; its output comes back to you, so prefer commands whose output answers your question.
- The shell is not stateful: each call is independent, so \`cd\` does not persist - chain it (\`cd dir && cmd\`) or use paths.
- Default \`waitForCompletion\` is true. Set it to false only for long-running processes (dev servers, watchers); afterwards interact through new commands, never by suggesting Ctrl+C.
- Use \`multi_edit\` to change files, not \`sed\`/\`awk\`/shell redirection. Use the terminal for running, testing, git, and inspecting.
- Do not run commands that need special/admin privileges. Format suggested follow-up commands as shell code blocks for the user.`,
    },
  ];
}
