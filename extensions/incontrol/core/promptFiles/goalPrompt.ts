import { SlashCommandWithSource } from "../index.js";

/**
 * Built-in `/goal` command.
 *
 * renderSlashCommand ("built-in" case) renders it as "Goal:\n\n<input>", which
 * is still sent as a normal user message so the agent starts working on the
 * goal right away. resolveEditorContent additionally stores the input as the
 * session goal that drives auto-continue.
 */
export const goalSlashCommand: SlashCommandWithSource = {
  name: "goal",
  description:
    "Set the goal for this session. The agent keeps working until it calls mark_goal_complete.",
  prompt: "Goal:",
  source: "built-in",
};
