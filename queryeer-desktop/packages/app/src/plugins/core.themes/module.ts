import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreThemesPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreThemesPlugin.manifest,
  plugin: coreThemesPlugin
};
