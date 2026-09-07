import { ConfigDependentToolParams, Tool } from "..";
import * as toolDefinitions from "./definitions";
import { applySlimmedToolDescriptions } from "./toolUsageDocs";

// I'm writing these as functions because we've messed up 3 TIMES by pushing to const, causing duplicate tool definitions on subsequent config loads.
//
// Slimmed to the two tools incontrol ships with: a terminal for running
// commands and a single multi-edit tool for changing files. Every other
// helper (read, ls, grep, search, fetch, rule, skill, view-diff, ...) is
// gone, so the model has nothing else to call.
export const getBaseToolDefinitions = (): Tool[] => [
  toolDefinitions.runTerminalCommandTool,
  toolDefinitions.multiEditTool,
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
