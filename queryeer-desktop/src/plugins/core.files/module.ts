import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreFilesPlugin } from "./plugin";
import "./files.css";

export const pluginModule: PluginModule = {
  manifest: coreFilesPlugin.manifest,
  plugin: coreFilesPlugin
};
