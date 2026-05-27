import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEngineJdbcPostgresPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineJdbcPostgresPlugin.manifest,
  plugin: coreQueryEngineJdbcPostgresPlugin
};
