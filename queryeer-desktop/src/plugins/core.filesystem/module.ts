import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreFileSystemPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreFileSystemPlugin.manifest,
  plugin: coreFileSystemPlugin
};
