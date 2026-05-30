import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEngineOutputFilePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineOutputFilePlugin.manifest,
  plugin: coreQueryEngineOutputFilePlugin
};
