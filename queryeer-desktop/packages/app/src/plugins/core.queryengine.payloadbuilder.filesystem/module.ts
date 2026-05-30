import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderFilesystemPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderFilesystemPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderFilesystemPlugin
};
