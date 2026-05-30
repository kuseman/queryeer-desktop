import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreSettingsPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreSettingsPlugin.manifest,
  plugin: coreSettingsPlugin
};
