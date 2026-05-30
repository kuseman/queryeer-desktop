import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEngineJdbcPostgresPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineJdbcPostgresPlugin.manifest,
  plugin: coreQueryEngineJdbcPostgresPlugin
};
