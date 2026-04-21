import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreFileWatcherPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreFileWatcherPlugin.manifest,
  plugin: coreFileWatcherPlugin
};
