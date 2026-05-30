import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreFileWatcherPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreFileWatcherPlugin.manifest,
  plugin: coreFileWatcherPlugin
};
