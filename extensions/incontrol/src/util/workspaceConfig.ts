import { workspace } from "vscode";

export const INCONTROL_WORKSPACE_KEY = "incontrol";

export function getIncontrolWorkspaceConfig() {
  return workspace.getConfiguration(INCONTROL_WORKSPACE_KEY);
}
