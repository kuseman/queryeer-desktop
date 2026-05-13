import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreExpressionsPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreExpressionsPlugin.manifest,
  plugin: coreExpressionsPlugin
};
