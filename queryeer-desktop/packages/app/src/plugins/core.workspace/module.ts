import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreWorkspacePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreWorkspacePlugin.manifest,
  plugin: coreWorkspacePlugin
};
