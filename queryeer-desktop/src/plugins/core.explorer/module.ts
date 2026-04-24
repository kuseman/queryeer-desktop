import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreExplorerPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreExplorerPlugin.manifest,
  plugin: coreExplorerPlugin
};