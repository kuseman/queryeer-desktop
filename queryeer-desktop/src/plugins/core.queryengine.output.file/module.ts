import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEngineOutputFilePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineOutputFilePlugin.manifest,
  plugin: coreQueryEngineOutputFilePlugin
};
