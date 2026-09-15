import { AssistantUnrolled } from "@incontrol/config-yaml";

// TODO
export const defaultConfigYaml: AssistantUnrolled = {
  models: [{
    name: "Autodetect",
    provider: "lmstudio",
    model: "AUTODETECT",
    apiBase: "http://127.0.0.1:8199/v1",
    capabilities: ["image_input"],
    roles: ["chat", "edit", "apply"],
  }],
  context: [],
  name: "Local Config",
  version: "1.0.0",
  schema: "v1",
};

export const defaultConfigYamlJetBrains: AssistantUnrolled = {
  models: [{
    name: "Autodetect",
    provider: "lmstudio",
    model: "AUTODETECT",
    apiBase: "http://127.0.0.1:8199/v1",
    capabilities: ["image_input"],
    roles: ["chat", "edit", "apply"],
  }],
  context: [],
  name: "Local Config",
  version: "1.0.0",
  schema: "v1",
};
