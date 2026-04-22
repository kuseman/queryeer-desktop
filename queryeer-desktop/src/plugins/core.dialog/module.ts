import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreDialogPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreDialogPlugin.manifest,
  plugin: coreDialogPlugin
};
