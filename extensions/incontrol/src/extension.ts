/**
 * This is the entry point for the extension.
 */

import { setupCa } from "core/util/ca";
import * as vscode from "vscode";
import type { BridgeHandle } from "../bridge/bridgeActivation";
import { initHostI18n, t } from "./util/i18n";

export { default as buildTimestamp } from "./.buildTimestamp";

/**
 * uwa sidecar 桥接句柄。
 *
 * 必须保存在模块作用域：deactivate() 时要用它做级联关闭，否则 uwa 拉起的
 * Chrome 进程会变成孤儿，并占住 chrome_profile 导致下次启动失败。
 */
let bridgeHandle: BridgeHandle | undefined;

async function dynamicImportAndActivate(context: vscode.ExtensionContext) {
  await setupCa();
  const { activateExtension } = await import("./activation/activate");
  return await activateExtension(context);
}

/**
 * 激活 uwa 桥接。
 *
 * 与主扩展的激活相互独立：桥接失败不应该让整个 incontrol 挂掉，
 * 反之亦然。因此单独 try/catch，且不 await 主流程。
 */
async function activateBridgeSafely(context: vscode.ExtensionContext) {
  try {
    const { activateBridge } = await import("../bridge/bridgeActivation");
    bridgeHandle = await activateBridge(context);
  } catch (e) {
    console.log("Error activating uwa bridge: ", e);
    vscode.window
      .showWarningMessage(
        t("Error activating the uwa sidecar bridge. Web chat features are unavailable."),
        t("View Logs"),
      )
      .then((selection) => {
        if (selection === t("View Logs")) {
          vscode.commands.executeCommand("incontrol.bridge.showLogs");
        }
      });
  }
}

export function activate(context: vscode.ExtensionContext) {
  initHostI18n(context.extensionPath);

  // 桥接与主扩展并行启动，互不阻塞
  void activateBridgeSafely(context);

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

export async function deactivate() {
  // 级联关闭 Python sidecar 及其拉起的 Chrome
  await bridgeHandle?.dispose();
  bridgeHandle = undefined;
}
