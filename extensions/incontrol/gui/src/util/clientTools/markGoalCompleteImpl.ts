import { completeGoal } from "../../redux/slices/sessionSlice";
import { ClientToolImpl } from "./callClientTool";

/**
 * Client-side implementation of mark_goal_complete.
 *
 * The session goal lives in the GUI's redux store, so completing it must
 * happen here rather than in core. Setting goal.completed stops the nudge
 * loop in streamNormalInput and triggers the GoalBar completion animation
 * (which then clears the goal after a short delay).
 */
export const markGoalCompleteImpl: ClientToolImpl = async (
  args,
  _toolCallId,
  extras,
) => {
  const summary =
    typeof args?.summary === "string" && args.summary.trim().length > 0
      ? args.summary.trim()
      : "The goal has been achieved.";

  extras.dispatch(completeGoal());

  return {
    respondImmediately: true,
    output: [
      {
        icon: "info",
        name: "Goal Complete",
        description: "Goal marked complete",
        content: summary,
        hidden: false,
      },
    ],
  };
};
