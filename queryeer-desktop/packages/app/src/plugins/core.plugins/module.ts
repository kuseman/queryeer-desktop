import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { corePluginsPlugin } from "./plugin";
import "./plugin-manager.css";

export const pluginModule: PluginModule = {
  manifest: corePluginsPlugin.manifest,
  plugin: corePluginsPlugin
};
