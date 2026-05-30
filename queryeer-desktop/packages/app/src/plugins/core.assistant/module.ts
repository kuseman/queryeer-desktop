import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreAssistantPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreAssistantPlugin.manifest,
  plugin: coreAssistantPlugin
};
