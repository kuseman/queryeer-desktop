import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { csvExporterPlugin } from "./plugin.js";

export const pluginModule: PluginModule = {
  manifest: csvExporterPlugin.manifest,
  plugin: csvExporterPlugin
};
