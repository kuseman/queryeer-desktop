import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreCommandsPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreCommandsPlugin.manifest,
  plugin: coreCommandsPlugin
};
