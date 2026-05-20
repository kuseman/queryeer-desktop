import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreAssistantPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreAssistantPlugin.manifest,
  plugin: coreAssistantPlugin
};
