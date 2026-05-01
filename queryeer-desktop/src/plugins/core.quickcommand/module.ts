import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQuickCommandPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQuickCommandPlugin.manifest,
  plugin: coreQuickCommandPlugin
};
