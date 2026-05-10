import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreThemesPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreThemesPlugin.manifest,
  plugin: coreThemesPlugin
};
