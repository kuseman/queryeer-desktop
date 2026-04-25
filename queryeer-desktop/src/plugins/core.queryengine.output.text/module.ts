import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEngineOutputTextPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineOutputTextPlugin.manifest,
  plugin: coreQueryEngineOutputTextPlugin
};
