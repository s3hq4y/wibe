import z from "zod";

import {
  BrowserSerializedIncontrolConfig,
  Config,
  IncontrolConfig,
  SerializedIncontrolConfig,
} from "..";

export const sharedConfigSchema = z
  .object({
    // boolean fields in config.json
    allowAnonymousTelemetry: z.boolean(),
    disableIndexing: z.boolean(),
    disableSessionTitles: z.boolean(),

    // `experimental` in `IncontrolConfig`
    useChromiumForDocsCrawling: z.boolean(),
    readResponseTTS: z.boolean(),
    promptPath: z.string(),
    useCurrentFileAsContext: z.boolean(),
    enableExperimentalTools: z.boolean(),
    onlyUseSystemMessageTools: z.boolean(),
    slimToolDescriptions: z.boolean(),
        enableStaticContextualization: z.boolean(),
        goalNudgeMessage: z.string(),
        maxGoalNudges: z.number(),

    // `ui` in `IncontrolConfig`
    showSessionTabs: z.boolean(),
    codeBlockToolbarPosition: z.enum(["top", "bottom"]),
    fontSize: z.number(),
    codeWrap: z.boolean(),
    displayRawMarkdown: z.boolean(),
    showChatScrollbar: z.boolean(),
    continueAfterToolRejection: z.boolean(),
    manualSystemMessage: z.string(),

    // `tabAutocompleteOptions` in `IncontrolConfig`
    useAutocompleteCache: z.boolean(),
    useAutocompleteMultilineCompletions: z.enum(["always", "never", "auto"]),
    disableAutocompleteInFiles: z.array(z.string()),
    modelTimeout: z.number(),
    debounceDelay: z.number(),
  })
  .partial();

export type SharedConfigSchema = z.infer<typeof sharedConfigSchema>;

// For security in case of damaged config file, try to salvage any security-related values
export function salvageSharedConfig(sharedConfig: object): SharedConfigSchema {
  const salvagedConfig: SharedConfigSchema = {};
  if ("allowAnonymousTelemetry" in sharedConfig) {
    const val = z.boolean().safeParse(sharedConfig.allowAnonymousTelemetry);
    if (val.success) {
      salvagedConfig.allowAnonymousTelemetry = val.data;
    }
  }
  if ("disableIndexing" in sharedConfig) {
    const val = z.boolean().safeParse(sharedConfig.disableIndexing);
    if (val.success) {
      salvagedConfig.disableIndexing = val.data;
    }
  }
  if ("disableSessionTitles" in sharedConfig) {
    const val = z.boolean().safeParse(sharedConfig.disableSessionTitles);
    if (val.success) {
      salvagedConfig.disableSessionTitles = val.data;
    }
  }
  if ("disableAutocompleteInFiles" in sharedConfig) {
    const val = sharedConfigSchema.shape.disableAutocompleteInFiles.safeParse(
      sharedConfig.disableAutocompleteInFiles,
    );
    if (val.success) {
      salvagedConfig.disableAutocompleteInFiles = val.data;
    }
  }
  return salvagedConfig;
}

// Apply shared config to all forms of config
// - SerializedIncontrolConfig (config.json)
// - Config ("intermediate") - passed to config.ts
// - IncontrolConfig
// - BrowserSerializedIncontrolConfig (final converted to be passed to GUI)

// This modify function is split into two steps
// - rectifySharedModelsFromSharedConfig - includes boolean flags like allowAnonymousTelemetry which
//   must be added BEFORE config.ts and remote server config apply for JSON
//   for security reasons
// - setSharedModelsFromSharedConfig - exists because of selectedModelsByRole
//   Which don't exist on SerializedIncontrolConfig/Config types, so must be added after the fact
export function modifyAnyConfigWithSharedConfig<
  T extends
    | IncontrolConfig
    | BrowserSerializedIncontrolConfig
    | Config
    | SerializedIncontrolConfig,
>(incontrolConfig: T, sharedConfig: SharedConfigSchema): T {
  const configCopy = { ...incontrolConfig };
  configCopy.tabAutocompleteOptions = {
    ...configCopy.tabAutocompleteOptions,
  };
  if (sharedConfig.useAutocompleteCache !== undefined) {
    configCopy.tabAutocompleteOptions.useCache =
      sharedConfig.useAutocompleteCache;
  }
  if (sharedConfig.useAutocompleteMultilineCompletions !== undefined) {
    configCopy.tabAutocompleteOptions.multilineCompletions =
      sharedConfig.useAutocompleteMultilineCompletions;
  }
  if (sharedConfig.disableAutocompleteInFiles !== undefined) {
    configCopy.tabAutocompleteOptions.disableInFiles =
      sharedConfig.disableAutocompleteInFiles;
  }
  if (sharedConfig.modelTimeout !== undefined) {
    configCopy.tabAutocompleteOptions.modelTimeout = sharedConfig.modelTimeout;
  }
  if (sharedConfig.debounceDelay !== undefined) {
    configCopy.tabAutocompleteOptions.debounceDelay =
      sharedConfig.debounceDelay;
  }

  configCopy.ui = {
    ...configCopy.ui,
  };

  if (sharedConfig.codeBlockToolbarPosition !== undefined) {
    configCopy.ui.codeBlockToolbarPosition =
      sharedConfig.codeBlockToolbarPosition;
  }
  if (sharedConfig.fontSize !== undefined) {
    configCopy.ui.fontSize = sharedConfig.fontSize;
  }
  if (sharedConfig.codeWrap !== undefined) {
    configCopy.ui.codeWrap = sharedConfig.codeWrap;
  }
  if (sharedConfig.displayRawMarkdown !== undefined) {
    configCopy.ui.displayRawMarkdown = sharedConfig.displayRawMarkdown;
  }
  if (sharedConfig.showChatScrollbar !== undefined) {
    configCopy.ui.showChatScrollbar = sharedConfig.showChatScrollbar;
  }
  if (sharedConfig.manualSystemMessage !== undefined) {
    configCopy.ui.manualSystemMessage = sharedConfig.manualSystemMessage;
  }

  if (sharedConfig.allowAnonymousTelemetry !== undefined) {
    configCopy.allowAnonymousTelemetry = sharedConfig.allowAnonymousTelemetry;
  }
  if (sharedConfig.disableIndexing !== undefined) {
    configCopy.disableIndexing = sharedConfig.disableIndexing;
  }
  if (sharedConfig.disableSessionTitles !== undefined) {
    configCopy.disableSessionTitles = sharedConfig.disableSessionTitles;
  }

  if (sharedConfig.showSessionTabs !== undefined) {
    configCopy.ui.showSessionTabs = sharedConfig.showSessionTabs;
  }

  if (sharedConfig.continueAfterToolRejection !== undefined) {
    configCopy.ui.continueAfterToolRejection =
      sharedConfig.continueAfterToolRejection;
  }

  configCopy.experimental = {
    ...configCopy.experimental,
  };

  if (sharedConfig.enableExperimentalTools !== undefined) {
    configCopy.experimental.enableExperimentalTools =
      sharedConfig.enableExperimentalTools;
  }

  if (sharedConfig.promptPath !== undefined) {
    configCopy.experimental.promptPath = sharedConfig.promptPath;
  }
  if (sharedConfig.useChromiumForDocsCrawling !== undefined) {
    configCopy.experimental.useChromiumForDocsCrawling =
      sharedConfig.useChromiumForDocsCrawling;
  }
  if (sharedConfig.readResponseTTS !== undefined) {
    configCopy.experimental.readResponseTTS = sharedConfig.readResponseTTS;
  }
  if (sharedConfig.useCurrentFileAsContext !== undefined) {
    configCopy.experimental.useCurrentFileAsContext =
      sharedConfig.useCurrentFileAsContext;
  }

  if (sharedConfig.onlyUseSystemMessageTools !== undefined) {
    configCopy.experimental.onlyUseSystemMessageTools =
      sharedConfig.onlyUseSystemMessageTools;
  }

  if (sharedConfig.slimToolDescriptions !== undefined) {
    configCopy.experimental.slimToolDescriptions =
      sharedConfig.slimToolDescriptions;
  }

  if (sharedConfig.enableStaticContextualization !== undefined) {
      configCopy.experimental.enableStaticContextualization =
        sharedConfig.enableStaticContextualization;
    }

    if (sharedConfig.goalNudgeMessage !== undefined) {
      configCopy.experimental.goalNudgeMessage =
        sharedConfig.goalNudgeMessage;
    }

    if (sharedConfig.maxGoalNudges !== undefined) {
      configCopy.experimental.maxGoalNudges =
        sharedConfig.maxGoalNudges;
    }

    return configCopy;
  }
