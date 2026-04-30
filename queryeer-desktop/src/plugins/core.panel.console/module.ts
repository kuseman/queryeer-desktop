import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { corePanelConsolePlugin } from "./plugin";
import "./console.css";

export const pluginModule: PluginModule = {
  manifest: corePanelConsolePlugin.manifest,
  plugin: corePanelConsolePlugin
};
