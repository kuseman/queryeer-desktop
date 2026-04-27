import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreQueryEngineOutputTablePlugin } from "./plugin";
import "./output-table.css";

export const pluginModule: PluginModule = {
  manifest: coreQueryEngineOutputTablePlugin.manifest,
  plugin: coreQueryEngineOutputTablePlugin
};
