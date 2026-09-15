import { ConfigYaml } from "@incontrol/config-yaml";

export const defaultConfig: ConfigYaml = {
  name: "Local Config",
  version: "1.0.0",
  schema: "v1",
  models: [{
    name: "Autodetect",
    provider: "lmstudio",
    model: "AUTODETECT",
    apiBase: "http://127.0.0.1:8199/v1",
    capabilities: ["image_input"],
    roles: ["chat", "edit", "apply"],
  }],
};
