import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreFilesPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreFilesPlugin.manifest,
  plugin: coreFilesPlugin
};
