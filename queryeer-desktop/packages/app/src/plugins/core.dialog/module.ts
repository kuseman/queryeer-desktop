import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreDialogPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreDialogPlugin.manifest,
  plugin: coreDialogPlugin
};
