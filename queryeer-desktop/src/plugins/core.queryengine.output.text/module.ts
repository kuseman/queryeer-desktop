import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEngineOutputTextPlugin } from "./plugin";
import "./output-text.css";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineOutputTextPlugin.manifest,
  plugin: coreQueryEngineOutputTextPlugin
};
