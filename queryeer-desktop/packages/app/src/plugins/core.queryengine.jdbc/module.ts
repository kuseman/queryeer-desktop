import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEngineJdbcPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineJdbcPlugin.manifest,
  plugin: coreQueryEngineJdbcPlugin
};
