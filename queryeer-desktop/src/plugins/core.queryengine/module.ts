import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEnginePlugin } from "./plugin";
import "./query-editor.css";

export const pluginModule: PluginModule = {
  manifest: coreQueryEnginePlugin.manifest,
  plugin: coreQueryEnginePlugin
};
