import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEngineJdbcSqlServerPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineJdbcSqlServerPlugin.manifest,
  plugin: coreQueryEngineJdbcSqlServerPlugin
};
