// ProfileHandlers manage the loading of a config, allowing us to abstract over different ways of getting to a IncontrolConfig

import { ConfigResult } from "@incontrol/config-yaml";
import { IncontrolConfig } from "../../index.js";
import { ProfileDescription } from "../ProfileLifecycleManager.js";

// After we have the IncontrolConfig, the ConfigHandler takes care of everything else (loading models, lifecycle, etc.)
export interface IProfileLoader {
  description: ProfileDescription;
  doLoadConfig(): Promise<ConfigResult<IncontrolConfig>>;
  setIsActive(isActive: boolean): void;
}
