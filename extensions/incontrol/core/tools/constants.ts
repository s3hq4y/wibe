export const NO_TOOL_CALL_OUTPUT_MESSAGE = "No tool output";
export const CANCELLED_TOOL_CALL_MESSAGE = "The user cancelled this tool call.";
export const ERRORED_TOOL_CALL_OUTPUT_MESSAGE =
  "There was an error calling the tool.";

// Used by every edit tool's prompt and by the bundled "tool-usage" skill to
// remind the model that edit tools cannot run in parallel.
export const NO_PARALLEL_TOOL_CALLING_INSTRUCTION =
  "This tool CANNOT be called in parallel with any other tools, including itself";
