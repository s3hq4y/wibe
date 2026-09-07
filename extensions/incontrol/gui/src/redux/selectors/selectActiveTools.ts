import { createSelector } from "@reduxjs/toolkit";
import { Tool } from "core";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "core/tools/builtIn";
import { DEFAULT_TOOL_SETTING } from "../slices/uiSlice";
import { RootState } from "../store";

export const selectActiveTools = createSelector(
  [
    (store: RootState) => store.config.config.tools,
    (store: RootState) => store.ui.toolSettings,
    (store: RootState) => store.ui.toolGroupSettings,
    (store: RootState) => store.session.goal,
  ],
  (tools, policies, groupPolicies, goal): Tool[] =>
    tools.filter((tool) => {
      // Only surface mark_goal_complete while a goal is actually set -
      // otherwise it is just noise in the tool list.
      if (tool.function.name === BuiltInToolNames.MarkGoalComplete) {
        return !!goal && !goal.completed;
      }
      const toolPolicy =
        policies[tool.function.name] ??
        tool.defaultToolPolicy ??
        DEFAULT_TOOL_SETTING;
      return (
        toolPolicy !== "disabled" && groupPolicies[tool.group] !== "exclude"
      );
    }),
);
