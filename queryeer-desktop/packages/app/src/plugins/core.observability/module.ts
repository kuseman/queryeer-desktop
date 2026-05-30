import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreObservabilityPlugin } from "./plugin";
import "./observability.css";

export const pluginModule: PluginModule = {
  manifest: coreObservabilityPlugin.manifest,
  plugin: coreObservabilityPlugin
};
