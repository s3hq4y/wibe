/**
 * This is the entry point for the extension.
 */

import { setupCa } from "core/util/ca";
import * as vscode from "vscode";
import { initHostI18n, t } from "./util/i18n";

export { default as buildTimestamp } from "./.buildTimestamp";

async function dynamicImportAndActivate(context: vscode.ExtensionContext) {
  await setupCa();
  const { activateExtension } = await import("./activation/activate");
  return await activateExtension(context);
}

export function activate(context: vscode.ExtensionContext) {
  initHostI18n(context.extensionPath);
  return dynamicImportAndActivate(context).catch((e) => {
    console.log("Error activating extension: ", e);
    vscode.window
      .showWarningMessage(
        t("Error activating the incontrol extension."),
        t("View Logs"),
        t("Retry")
      )
      .then((selection) => {
        if (selection === t("View Logs")) {
          vscode.commands.executeCommand("incontrol.viewLogs");
        } else if (selection === t("Retry")) {
          // Reload VS Code window
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  });
}

export function deactivate() {}
