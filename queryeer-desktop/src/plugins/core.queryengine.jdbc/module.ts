import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEngineJdbcPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineJdbcPlugin.manifest,
  plugin: coreQueryEngineJdbcPlugin
};
