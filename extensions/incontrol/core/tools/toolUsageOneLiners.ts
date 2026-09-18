import { BuiltInToolNames } from "./builtIn";

export const TOOL_USAGE_ONE_LINERS: Record<string, string> = {
  [BuiltInToolNames.RunTerminalCommand]:
    "Run a terminal command in the current workspace.",
  [BuiltInToolNames.MultiEdit]:
    "Apply multiple find/replace edits to a single file in one atomic call.",
  [BuiltInToolNames.FetchImage]:
    "Fetch an image from an http(s) URL or local path so you can see it directly.",
  [BuiltInToolNames.MarkGoalComplete]:
    "Declare the active session goal achieved (the only way to stop goal tracking).",
};
