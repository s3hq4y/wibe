import fs from "fs";

import { getIncontrolGlobalPath } from "core/util/paths";
import { ExtensionContext } from "vscode";

/**
 * Clear all incontrol-related artifacts to simulate a brand new user
 */
export function cleanSlate(context: ExtensionContext) {
  // Commented just to be safe
  // // Remove ~/.incontrol
  // const globalPath = getIncontrolGlobalPath();
  // if (fs.existsSync(globalPath)) {
  //   fs.rmSync(globalPath, { recursive: true, force: true });
  // }
  // // Clear extension's globalState
  // context.globalState.keys().forEach((key) => {
  //   context.globalState.update(key, undefined);
  // });
}
