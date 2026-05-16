import type { PluginModule } from "../../contracts/plugin/PluginModule.js";
import { coreAboutPlugin } from "./plugin.js";

export const pluginModule: PluginModule = {
  manifest: coreAboutPlugin.manifest,
  plugin: coreAboutPlugin
};
