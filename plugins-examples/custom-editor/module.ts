import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { customEditorPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: customEditorPlugin.manifest,
  plugin: customEditorPlugin
};
