import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreSecurityPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreSecurityPlugin.manifest,
  plugin: coreSecurityPlugin
};
