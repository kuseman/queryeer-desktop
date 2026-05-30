import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreGraphPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreGraphPlugin.manifest,
  plugin: coreGraphPlugin
};
