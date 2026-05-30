import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreExpressionsPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreExpressionsPlugin.manifest,
  plugin: coreExpressionsPlugin
};
