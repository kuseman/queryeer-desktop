import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderFilesystemPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderFilesystemPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderFilesystemPlugin
};
