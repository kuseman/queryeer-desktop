import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderKafkaPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderKafkaPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderKafkaPlugin
};
