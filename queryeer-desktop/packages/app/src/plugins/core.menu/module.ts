import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreMenuPlugin } from "./plugin";
import "./menu.css";

export const pluginModule: PluginModule = {
  manifest: coreMenuPlugin.manifest,
  plugin: coreMenuPlugin
};
