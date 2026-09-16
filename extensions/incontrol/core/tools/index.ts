import { ConfigDependentToolParams, Tool } from "..";
import * as toolDefinitions from "./definitions";
import { applySlimmedToolDescriptions } from "./toolUsageDocs";

// I'm writing these as functions because we've messed up 3 TIMES by pushing to const, causing duplicate tool definitions on subsequent config loads.
//
// Slimmed to a terminal for running commands, a single multi-edit tool for
// changing files, and the goal-complete signal. Every other helper (read, ls,
// grep, search, fetch, rule, skill, view-diff, ...) is gone, so the model has
// nothing else to call. mark_goal_complete is only surfaced by
// selectActiveTools while a session goal is active.
export const getBaseToolDefinitions = (): Tool[] => [
  toolDefinitions.runTerminalCommandTool,
  toolDefinitions.multiEditTool,
  toolDefinitions.markGoalCompleteTool,
];

// Kept for backwards compatibility with code that expects
// getConfigDependentToolDefinitions; nothing extra is added.
export const getConfigDependentToolDefinitions = async (
  _params: ConfigDependentToolParams,
): Promise<Tool[]> => {
  return [];
};

export function serializeTool(tool: Tool) {
  const { preprocessArgs, evaluateToolCallPolicy, ...rest } = tool;
  return rest;
}

/**
 * When the "slim tool descriptions" experiment is on, swap full descriptions
 * for one-liners. With only two tools shipped, no get_tool_usage helper is
 * needed; descriptions are short enough to ship in-line.
 */
export function finalizeTools(
  tools: Tool[],
  slimToolDescriptions: boolean,
): Tool[] {
  if (!slimToolDescriptions) {
    return tools;
  }
  return applySlimmedToolDescriptions(tools);
}
