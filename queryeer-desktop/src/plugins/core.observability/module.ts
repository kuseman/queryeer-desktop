import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreObservabilityPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreObservabilityPlugin.manifest,
  plugin: coreObservabilityPlugin
};
