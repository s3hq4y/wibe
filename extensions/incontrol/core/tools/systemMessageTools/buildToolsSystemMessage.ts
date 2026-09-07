import { Tool } from "../..";
import { BuiltInToolNames } from "../builtIn";
import { TOOL_USAGE_ONE_LINERS } from "../toolUsageOneLiners";
import { closeTag } from "./systemToolUtils";
import { SystemMessageToolsFramework } from "./types";

export const TOOL_INSTRUCTIONS_TAG = "<tool_use_instructions>";

export const generateToolsSystemMessage = (
  tools: Tool[],
  framework: SystemMessageToolsFramework,
  slimToolDescriptions = false,
): string => {
  if (tools.length === 0) {
    return "";
  }

  const instructions: string[] = [];
  instructions.push(TOOL_INSTRUCTIONS_TAG);
  instructions.push(framework.systemMessagePrefix);

  if (slimToolDescriptions) {
    // Compact directory: one line per tool. Call syntax (prefix, generic
    // example, suffix) is kept so the model still knows how to call tools.
    instructions.push(
      `\nThe following tools are available. Their usage here is intentionally brief - call the ${BuiltInToolNames.GetToolUsage} tool with a toolName to see its full documentation before using it for the first time:`,
    );
    for (const tool of tools) {
      const oneLiner = TOOL_USAGE_ONE_LINERS[tool.function.name];
      if (oneLiner) {
        instructions.push(`\n- ${tool.function.name}: ${oneLiner}`);
      } else if (tool.function.name === BuiltInToolNames.ReadSkill) {
        // read_skill's description is the directory of available skills and
        // must survive slimming.
        const definition = tool.systemMessageDescription
          ? framework.createSystemMessageExampleCall(
              tool.function.name,
              tool.systemMessageDescription.prefix,
              tool.systemMessageDescription.exampleArgs,
            )
          : framework.toolToSystemToolDefinition(tool);
        instructions.push(`\n${definition}`);
      } else if (tool.systemMessageDescription) {
        const definition = framework.createSystemMessageExampleCall(
          tool.function.name,
          tool.systemMessageDescription.prefix,
          tool.systemMessageDescription.exampleArgs,
        );
        instructions.push(`\n${definition}`);
      } else {
        try {
          const definition = framework.toolToSystemToolDefinition(tool);
          instructions.push(`\n${definition}`);
        } catch (e) {
          console.error(
            "Failed to convert tool to system message tool:\n" +
              JSON.stringify(tool),
          );
        }
      }
    }

    instructions.push(`\nFor example, this tool definition:\n`);
    instructions.push(framework.exampleDynamicToolDefinition);
    instructions.push("\nCan be called like this:\n");
    instructions.push(framework.exampleDynamicToolCall);
    instructions.push("\n" + framework.systemMessageSuffix);
    instructions.push(`${closeTag(TOOL_INSTRUCTIONS_TAG)}`);
    return instructions.join("\n");
  }

  const withPredefinedMessage = tools.filter(
    (tool) => !!tool.systemMessageDescription,
  );

  const withDynamicMessage = tools.filter(
    (tool) => !tool.systemMessageDescription,
  );

  if (withPredefinedMessage.length > 0) {
    instructions.push(`\nThe following tools are available to you:`);
    for (const tool of withPredefinedMessage) {
      const definition = framework.createSystemMessageExampleCall(
        tool.function.name,
        tool.systemMessageDescription!.prefix,
        tool.systemMessageDescription!.exampleArgs,
      );
      instructions.push(`\n${definition}`);
    }
  }

  if (withDynamicMessage.length > 0) {
    instructions.push(
      `\nAlso, these additional tool definitions show other tools you can call with the same syntax:`,
    );

    for (const tool of withDynamicMessage) {
      try {
        const definition = framework.toolToSystemToolDefinition(tool);
        instructions.push(`\n${definition}`);
      } catch (e) {
        console.error(
          "Failed to convert tool to system message tool:\n" +
            JSON.stringify(tool),
        );
      }
    }

    instructions.push(`\nFor example, this tool definition:\n`);
    instructions.push(framework.exampleDynamicToolDefinition);
    instructions.push("\nCan be called like this:\n");
    instructions.push(framework.exampleDynamicToolCall);
  }

  instructions.push("\n" + framework.systemMessageSuffix);

  instructions.push(`${closeTag(TOOL_INSTRUCTIONS_TAG)}`);
  return instructions.join("\n");
};

export function addSystemMessageToolsToSystemMessage(
  framework: SystemMessageToolsFramework,
  baseSystemMessage: string,
  systemMessageTools: Tool[],
  slimToolDescriptions = false,
): string {
  let systemMessage = baseSystemMessage;
  if (systemMessageTools.length > 0) {
    const toolsSystemMessage = generateToolsSystemMessage(
      systemMessageTools,
      framework,
      slimToolDescriptions,
    );
    systemMessage += `\n\n${toolsSystemMessage}`;
  }

  return systemMessage;
}
