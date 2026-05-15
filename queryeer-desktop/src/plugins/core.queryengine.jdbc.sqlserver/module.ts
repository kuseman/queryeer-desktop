import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEngineJdbcSqlServerPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineJdbcSqlServerPlugin.manifest,
  plugin: coreQueryEngineJdbcSqlServerPlugin
};
