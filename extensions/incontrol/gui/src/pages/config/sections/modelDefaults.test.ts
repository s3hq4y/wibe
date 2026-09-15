import { describe, it, expect } from "vitest";
import { defaultConfig } from "core/config/default";
import { defaultConfigYaml, defaultConfigYamlJetBrains } from "core/config/yaml/default";

describe("new configuration defaults", () => {
  it.each([defaultConfig, defaultConfigYaml, defaultConfigYamlJetBrains])("uses local automatic discovery without embedding credentials", config => {
    expect(config.name).toBe("Local Config");
    expect(config.models).toHaveLength(1);
    expect(config.models![0]).toMatchObject({name: "Autodetect", provider: "lmstudio", model: "AUTODETECT", apiBase: "http://127.0.0.1:8199/v1", capabilities: ["image_input"]});
    expect(config.models![0]).not.toHaveProperty("apiKey");
  });
});
