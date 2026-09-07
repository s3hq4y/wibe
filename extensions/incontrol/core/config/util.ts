import { ModelConfig } from "@incontrol/config-yaml";
import {
  IncontrolConfig,
  ExperimentalModelRoles,
  ILLM,
  JSONModelDescription,
  PromptTemplate,
} from "../";
import { editConfigFile } from "../util/paths";

function stringify(obj: any, indentation?: number): string {
  return JSON.stringify(
    obj,
    (key, value) => {
      return value === null ? undefined : value;
    },
    indentation,
  );
}

export function addModel(
  model: JSONModelDescription,
  role?: keyof ExperimentalModelRoles,
) {
  editConfigFile(
    (config) => {
      if (config.models?.some((m) => stringify(m) === stringify(model))) {
        return config;
      }

      const numMatches = config.models?.reduce(
        (prev, curr) => (curr.title.startsWith(model.title) ? prev + 1 : prev),
        0,
      );
      if (numMatches !== undefined && numMatches > 0) {
        model.title = `${model.title} (${numMatches})`;
      }

      config.models.push(model);

      // Set the role for the model
      if (role) {
        if (!config.experimental) {
          config.experimental = {};
        }
        if (!config.experimental.modelRoles) {
          config.experimental.modelRoles = {};
        }
        config.experimental.modelRoles[role] = model.title;
      }

      return config;
    },
    (config) => {
      const numMatches = config.models?.reduce(
        (prev, curr) =>
          "name" in curr && curr.name.startsWith(model.title) ? prev + 1 : prev,
        0,
      );
      if (numMatches !== undefined && numMatches > 0) {
        model.title = `${model.title} (${numMatches})`;
      }

      if (!config.models) {
        config.models = [];
      }

      const capabilities: string[] = [];
      if (model.capabilities?.tools) capabilities.push("tool_use");
      if (model.capabilities?.uploadImage) capabilities.push("image_input");

      const desc: ModelConfig = {
        name: model.title,
        provider: model.provider,
        model: model.model,
        apiKey: model.apiKey,
        apiBase: model.apiBase,
        contextLength: model.contextLength,
        maxStopWords: model.maxStopWords,
        defaultCompletionOptions: model.completionOptions,
        ...(capabilities.length > 0 ? { capabilities } : {}),
      };
      config.models.push(desc);
      return config;
    },
  );
}

export function deleteModel(title: string) {
  editConfigFile(
    (config) => {
      config.models = config.models.filter((m: any) => m.title !== title);
      return config;
    },
    (config) => {
      config.models = config.models?.filter((m: any) => m.name !== title);
      return config;
    },
  );
}

export function getModelByRole<T extends keyof ExperimentalModelRoles>(
  config: IncontrolConfig,
  role: T,
): ILLM | undefined {
  const roleTitle = config.experimental?.modelRoles?.[role];

  if (!roleTitle) {
    return undefined;
  }

  const matchingModel = config.modelsByRole.chat.find(
    (model) => model.title === roleTitle,
  );

  return matchingModel;
}

/**
 * This is required because users are only able to define prompt templates as a
 * string, while internally we also allow prompt templates to be functions
 * @param templates
 * @returns
 */
export function serializePromptTemplates(
  templates: Record<string, PromptTemplate> | undefined,
): Record<string, string> | undefined {
  if (!templates) return undefined;

  return Object.fromEntries(
    Object.entries(templates).map(([key, template]) => {
      const serialized = typeof template === "function" ? "" : template;
      return [key, serialized];
    }),
  );
}
