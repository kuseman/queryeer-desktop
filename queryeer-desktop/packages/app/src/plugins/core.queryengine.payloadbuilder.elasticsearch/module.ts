import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderElasticsearchPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderElasticsearchPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderElasticsearchPlugin
};
