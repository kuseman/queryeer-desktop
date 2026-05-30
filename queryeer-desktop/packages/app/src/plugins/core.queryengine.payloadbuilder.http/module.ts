import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderHttpPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderHttpPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderHttpPlugin
};
