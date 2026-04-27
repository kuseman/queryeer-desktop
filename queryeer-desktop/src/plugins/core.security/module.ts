import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreSecurityPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreSecurityPlugin.manifest,
  plugin: coreSecurityPlugin
};
