import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderPlugin } from "./plugin";
import "./payloadbuilder.css";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderPlugin
};
