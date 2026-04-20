import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreCommandsPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreCommandsPlugin.manifest,
  plugin: coreCommandsPlugin
};
