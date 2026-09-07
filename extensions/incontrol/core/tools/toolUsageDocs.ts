import { Tool } from "..";
import { TOOL_USAGE_ONE_LINERS } from "./toolUsageOneLiners";
import { multiEditTool, runTerminalCommandTool } from "./definitions";

function getStaticDocTools(): Tool[] {
  return [runTerminalCommandTool, multiEditTool];
}

/** Full descriptions of every statically defined built-in tool, by name. */
export function getStaticToolDocs(): Record<string, string> {
  const docs: Record<string, string> = {};
  for (const tool of getStaticDocTools()) {
    docs[tool.function.name] = tool.function.description ?? "";
  }
  return docs;
}

export function applySlimmedToolDescriptions(tools: Tool[]): Tool[] {
  return tools.map((tool) => {
    const oneLiner = TOOL_USAGE_ONE_LINERS[tool.function.name];
    return oneLiner
      ? { ...tool, function: { ...tool.function, description: oneLiner } }
      : tool;
  });
}
