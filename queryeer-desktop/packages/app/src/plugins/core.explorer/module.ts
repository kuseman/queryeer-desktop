import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreExplorerPlugin } from "./plugin";
import "./explorer.css";

export const pluginModule: PluginModule = {
  manifest: coreExplorerPlugin.manifest,
  plugin: coreExplorerPlugin
};
