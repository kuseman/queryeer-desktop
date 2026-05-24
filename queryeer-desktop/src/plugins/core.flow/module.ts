import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreFlowPlugin } from "./plugin";
import "./flow.css";

export const pluginModule: PluginModule = {
  manifest: coreFlowPlugin.manifest,
  plugin: coreFlowPlugin
};
