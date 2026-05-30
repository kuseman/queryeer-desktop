import type { PluginModule } from "@queryeer/api/plugin/PluginModule.js";
import { coreAboutPlugin } from "./plugin.js";

export const pluginModule: PluginModule = {
  manifest: coreAboutPlugin.manifest,
  plugin: coreAboutPlugin
};
