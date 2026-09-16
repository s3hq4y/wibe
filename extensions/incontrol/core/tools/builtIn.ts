export enum BuiltInToolNames {
  ReadFile = "read_file",
  ReadFileRange = "read_file_range",
  EditExistingFile = "edit_existing_file",
  SingleFindAndReplace = "single_find_and_replace",
  MultiEdit = "multi_edit",
  ReadCurrentlyOpenFile = "read_currently_open_file",
  CreateNewFile = "create_new_file",
  RunTerminalCommand = "run_terminal_command",
  GrepSearch = "grep_search",
  FileGlobSearch = "file_glob_search",
  SearchWeb = "search_web",
  ViewDiff = "view_diff",
  LSTool = "ls",
  CreateRuleBlock = "create_rule_block",
  RequestRule = "request_rule",
  FetchUrlContent = "fetch_url_content",
  ReadSkill = "read_skill",
  MarkGoalComplete = "mark_goal_complete",
  GetToolUsage = "get_tool_usage",
}

export const BUILT_IN_GROUP_NAME = "Built-In";

// The set of built-in tools that run in the GUI / extension host rather than
// in core: multi_edit (file edits) and mark_goal_complete (which mutates the
// GUI-side session goal). The terminal tool is dispatched to core. The core
// import side filters by this list to decide which tool calls stay in core
// versus which ones run in the client.
export const CLIENT_TOOLS_IMPLS = [
  BuiltInToolNames.MultiEdit,
  BuiltInToolNames.MarkGoalComplete,
];
