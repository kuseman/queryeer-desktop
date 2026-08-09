import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderMongoPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderMongoPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderMongoPlugin
};
