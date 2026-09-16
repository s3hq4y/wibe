import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

export interface MarkGoalCompleteArgs {
  summary: string;
}

/**
 * Client-side tool that lets the agent declare the session goal achieved.
 *
 * The goal loop in streamNormalInput keeps nudging the model while
 * session.goal exists and is not completed, so this tool is the only way to
 * stop that loop. It runs on the GUI side (see callClientTool) because the
 * goal lives in the GUI's session slice, and it is surfaced by
 * selectActiveTools only while a goal is active.
 */
export const markGoalCompleteTool: Tool = {
  type: "function",
  displayTitle: "Mark Goal Complete",
  wouldLikeTo: "mark the goal complete",
  isCurrently: "marking the goal complete",
  hasAlready: "marked the goal complete",
  group: BUILT_IN_GROUP_NAME,
  readonly: true,
  isInstant: true,
  function: {
    name: BuiltInToolNames.MarkGoalComplete,
    description: `Call this tool to declare the current session goal achieved. This is the only thing that stops goal tracking - stating the goal is complete in plain text does nothing.

Rules:
- Only call this once the goal has genuinely been met and verified.
- Provide a one-sentence summary of how the goal was achieved.`,
    parameters: {
      type: "object",
      required: ["summary"],
      properties: {
        summary: {
          type: "string",
          description: "One sentence on how the goal was achieved.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To signal that the goal you were given has been achieved, use the ${BuiltInToolNames.MarkGoalComplete} tool. This is the only way to stop goal tracking; stating completion in plain text does not.

For example, you could respond with:`,
    exampleArgs: [["summary", "Refactored the parser and all tests pass."]],
  },
};
