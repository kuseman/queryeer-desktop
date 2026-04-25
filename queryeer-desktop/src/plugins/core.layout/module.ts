import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreLayoutPlugin } from "./plugin";
import "./layout.css";

export const pluginModule: PluginModule = {
  manifest: coreLayoutPlugin.manifest,
  plugin: coreLayoutPlugin
};
