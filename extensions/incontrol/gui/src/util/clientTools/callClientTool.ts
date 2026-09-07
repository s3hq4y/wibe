import { ContextItem, ToolCallState } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { IncontrolError, IncontrolErrorReason } from "core/util/errors";
import { IIdeMessenger } from "../../context/IdeMessenger";
import { AppThunkDispatch, RootState } from "../../redux/store";
import { multiEditImpl } from "./multiEditImpl";

export interface ClientToolExtras {
  getState: () => RootState;
  dispatch: AppThunkDispatch;
  ideMessenger: IIdeMessenger;
}

export interface ClientToolOutput {
  output: ContextItem[] | undefined;
  respondImmediately: boolean;
}

export interface ClientToolResult extends ClientToolOutput {
  error?: IncontrolError;
}

export type ClientToolImpl = (
  args: any,
  toolCallId: string,
  extras: ClientToolExtras,
) => Promise<ClientToolOutput>;

// In this build only multi_edit runs on the client side; the terminal tool
// is dispatched to core. The other client tools (edit_existing_file,
// single_find_and_replace, mark_goal_complete) were removed when the tool
// list was slimmed down to terminal + multi_edit, so the switch has just one
// reachable case.
export async function callClientTool(
  toolCallState: ToolCallState,
  extras: ClientToolExtras,
): Promise<ClientToolResult> {
  const { toolCall, parsedArgs } = toolCallState;
  try {
    let output: ClientToolOutput;
    switch (toolCall.function.name) {
      case BuiltInToolNames.MultiEdit:
        output = await multiEditImpl(parsedArgs, toolCall.id, extras);
        break;
      default:
        throw new Error(`Invalid client tool name ${toolCall.function.name}`);
    }
    return output;
  } catch (e) {
    return {
      respondImmediately: true,
      error:
        e instanceof IncontrolError
          ? e
          : e instanceof Error
            ? new IncontrolError(IncontrolErrorReason.Unspecified, e.message)
            : new IncontrolError(IncontrolErrorReason.Unknown, String(e)),
      output: undefined,
    };
  }
}
