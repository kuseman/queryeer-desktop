import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderElasticsearchPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderElasticsearchPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderElasticsearchPlugin
};
