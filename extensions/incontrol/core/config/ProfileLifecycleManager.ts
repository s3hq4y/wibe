import {
  ConfigResult,
  ConfigValidationError,
  FullSlug,
} from "@incontrol/config-yaml";

import {
  BrowserSerializedIncontrolConfig,
  IncontrolConfig,
  IContextProvider,
  IDE,
} from "../index.js";

import { Logger } from "../util/Logger.js";
import { finalToBrowserConfig } from "./load.js";
import { IProfileLoader } from "./profile/IProfileLoader.js";

export interface ProfileDescription {
  fullSlug: FullSlug;
  title: string;
  id: string;
  iconUrl: string;
  errors: ConfigValidationError[] | undefined;
  uri: string;
  rawYaml?: string;
}

export class ProfileLifecycleManager {
  private savedConfigResult: ConfigResult<IncontrolConfig> | undefined;
  private savedBrowserConfigResult?: ConfigResult<BrowserSerializedIncontrolConfig>;
  private pendingConfigPromise?: Promise<ConfigResult<IncontrolConfig>>;

  constructor(
    private readonly profileLoader: IProfileLoader,
    private readonly ide: IDE,
  ) {}

  get profileDescription(): ProfileDescription {
    return this.profileLoader.description;
  }

  clearConfig() {
    this.savedConfigResult = undefined;
    this.savedBrowserConfigResult = undefined;
    this.pendingConfigPromise = undefined;
  }

  // Clear saved config and reload
  async reloadConfig(
    additionalContextProviders: IContextProvider[] = [],
  ): Promise<ConfigResult<IncontrolConfig>> {
    this.savedConfigResult = undefined;
    this.savedBrowserConfigResult = undefined;
    this.pendingConfigPromise = undefined;

    return this.loadConfig(additionalContextProviders, true);
  }

  async loadConfig(
    additionalContextProviders: IContextProvider[],
    forceReload: boolean = false,
  ): Promise<ConfigResult<IncontrolConfig>> {
    // If we already have a config, return it
    if (!forceReload) {
      if (this.savedConfigResult) {
        return this.savedConfigResult;
      } else if (this.pendingConfigPromise) {
        return this.pendingConfigPromise;
      }
    }

    // Set pending config promise
    this.pendingConfigPromise = new Promise((resolve) => {
      void (async () => {
        let result: ConfigResult<IncontrolConfig>;
        // This try catch is expected to catch high-level errors that aren't block-specific
        // Like invalid json, invalid yaml, file read errors, etc.
        // NOT block-specific loading errors
        try {
          result = await this.profileLoader.doLoadConfig();
        } catch (e) {
          Logger.error(e, {
            context: "profile_config_loading",
          });

          const message =
            e instanceof Error
              ? `${e.message}\n${e.stack ? e.stack : ""}`
              : "Error loading config";
          result = {
            errors: [
              {
                fatal: true,
                message,
              },
            ],
            config: undefined,
            configLoadInterrupted: true,
          };
        }

        if (result.config) {
          // Add registered context providers
          result.config.contextProviders = (
            result.config.contextProviders ?? []
          ).concat(additionalContextProviders);
        }

        resolve(result);
      })();
    });

    // Wait for the config promise to resolve
    this.savedConfigResult = await this.pendingConfigPromise;
    this.pendingConfigPromise = undefined;
    return this.savedConfigResult;
  }

  async getSerializedConfig(
    additionalContextProviders: IContextProvider[],
  ): Promise<ConfigResult<BrowserSerializedIncontrolConfig>> {
    if (this.savedBrowserConfigResult) {
      return this.savedBrowserConfigResult;
    } else {
      const result = await this.loadConfig(additionalContextProviders);
      if (!result.config) {
        return {
          ...result,
          config: undefined,
        };
      }
      const serializedConfig = await finalToBrowserConfig(
        result.config,
        this.ide,
      );
      return {
        ...result,
        config: serializedConfig,
      };
    }
  }
}
