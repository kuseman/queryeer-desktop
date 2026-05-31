import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { weatherCatalogPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: weatherCatalogPlugin.manifest,
  plugin: weatherCatalogPlugin
};
