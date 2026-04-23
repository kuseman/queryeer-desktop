import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreEditorPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreEditorPlugin.manifest,
  plugin: coreEditorPlugin
};