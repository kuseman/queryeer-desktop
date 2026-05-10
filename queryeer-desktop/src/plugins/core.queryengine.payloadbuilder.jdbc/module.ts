import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderJdbcPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderJdbcPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderJdbcPlugin
};
