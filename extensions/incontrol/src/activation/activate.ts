import { getIncontrolRcPath, getTsConfigPath } from "core/util/paths";
import * as vscode from "vscode";

import { VsCodeExtension } from "../extension/VsCodeExtension";
import { isUnsupportedPlatform } from "../util/util";

import { GlobalContext } from "core/util/GlobalContext";
import { VsCodeIncontrolApi } from "./api";
import setupInlineTips from "./InlineTipManager";

export async function activateExtension(context: vscode.ExtensionContext) {
  const platformCheck = isUnsupportedPlatform();
  const globalContext = new GlobalContext();
  const hasShownUnsupportedPlatformWarning = globalContext.get(
    "hasShownUnsupportedPlatformWarning"
  );

  if (platformCheck.isUnsupported && !hasShownUnsupportedPlatformWarning) {
    const platformTarget = "windows-arm64";

    globalContext.update("hasShownUnsupportedPlatformWarning", true);
    void vscode.window.showInformationMessage(
      `incontrol detected that you are using ${platformTarget}. Due to native dependencies, incontrol may not be able to start`
    );
  }

  // Add necessary files
  getTsConfigPath();
  getIncontrolRcPath();

  // Register commands and providers
  setupInlineTips(context);

  const vscodeExtension = new VsCodeExtension(context);

  // Load incontrol configuration
  if (!context.globalState.get("hasBeenInstalled")) {
    void context.globalState.update("hasBeenInstalled", true);
  }

  // Register config.yaml schema by removing old entries and adding new one (uri.fsPath changes with each version)
  const yamlMatcher = ".incontrol/**/*.yaml";
  const legacyYamlMatcher = ".continue/**/*.yaml";
  const yamlConfig = vscode.workspace.getConfiguration("yaml");
  const yamlSchemas = yamlConfig.get<object>("schemas", {});

  const newPath = vscode.Uri.joinPath(
    context.extension.extensionUri,
    "config-yaml-schema.json"
  ).toString();

  // Drop schema entries registered by previous versions (stale extension URIs
  // and the pre-rebrand .continue matcher).
  const prunedSchemas = Object.fromEntries(
    Object.entries(yamlSchemas).filter(([uri, matchers]) => {
      if (uri === newPath) {
        return false;
      }
      const list = Array.isArray(matchers) ? matchers : [matchers];
      return !list.some(
        (m) => m === yamlMatcher || m === legacyYamlMatcher,
      );
    }),
  );

  try {
    await yamlConfig.update(
      "schemas",
      {
        ...prunedSchemas,
        [newPath]: [yamlMatcher],
      },
      vscode.ConfigurationTarget.Global
    );
  } catch (error) {
    console.error(
      "Failed to register incontrol config.yaml schema, most likely, YAML extension is not installed",
      error
    );
  }

  const api = new VsCodeIncontrolApi(vscodeExtension);
  const incontrolPublicApi = {
    registerCustomContextProvider: api.registerCustomContextProvider.bind(api),
  };

  // 'export' public api-surface
  // or entire extension for testing
  return process.env.NODE_ENV === "test"
    ? {
        ...incontrolPublicApi,
        extension: vscodeExtension,
      }
    : incontrolPublicApi;
}
