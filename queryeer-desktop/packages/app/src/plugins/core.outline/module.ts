import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreOutlinePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreOutlinePlugin.manifest,
  plugin: coreOutlinePlugin
};
