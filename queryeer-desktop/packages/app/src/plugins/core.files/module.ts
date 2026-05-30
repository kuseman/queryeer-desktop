import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreFilesPlugin } from "./plugin";
import "./files.css";

export const pluginModule: PluginModule = {
  manifest: coreFilesPlugin.manifest,
  plugin: coreFilesPlugin
};
