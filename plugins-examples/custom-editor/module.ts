import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { customEditorPlugin } from "./plugin.js";

export const pluginModule: PluginModule = {
  manifest: customEditorPlugin.manifest,
  plugin: customEditorPlugin
};
