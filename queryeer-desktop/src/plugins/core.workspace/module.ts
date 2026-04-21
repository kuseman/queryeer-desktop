import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreWorkspacePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreWorkspacePlugin.manifest,
  plugin: coreWorkspacePlugin
};
