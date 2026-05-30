import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderJdbcPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderJdbcPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderJdbcPlugin
};
