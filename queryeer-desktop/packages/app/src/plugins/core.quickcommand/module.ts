import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQuickCommandPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQuickCommandPlugin.manifest,
  plugin: coreQuickCommandPlugin
};
