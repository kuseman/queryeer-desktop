import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEngineJdbcSqlitePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineJdbcSqlitePlugin.manifest,
  plugin: coreQueryEngineJdbcSqlitePlugin
};
