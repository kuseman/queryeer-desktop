import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreEditorPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreEditorPlugin.manifest,
  plugin: coreEditorPlugin
};
