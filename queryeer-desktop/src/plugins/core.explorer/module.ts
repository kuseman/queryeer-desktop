import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreExplorerPlugin } from "./plugin";
import "./explorer.css";

export const pluginModule: PluginModule = {
  manifest: coreExplorerPlugin.manifest,
  plugin: coreExplorerPlugin
};
