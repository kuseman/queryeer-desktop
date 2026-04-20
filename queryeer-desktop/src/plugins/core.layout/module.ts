import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreLayoutPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreLayoutPlugin.manifest,
  plugin: coreLayoutPlugin
};
