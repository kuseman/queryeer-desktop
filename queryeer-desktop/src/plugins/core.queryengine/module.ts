import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEnginePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePlugin.manifest,
  plugin: coreQueryEnginePlugin
};
