import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEnginePayloadbuilderHttpPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePayloadbuilderHttpPlugin.manifest,
  plugin: coreQueryEnginePayloadbuilderHttpPlugin
};
