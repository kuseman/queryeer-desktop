import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreFileSystemPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreFileSystemPlugin.manifest,
  plugin: coreFileSystemPlugin
};
