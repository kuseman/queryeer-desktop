import type { PluginManifest } from "./PluginManifest.js";
import type { Plugin } from "./Plugin.js";

export type PluginModule = {
  manifest: PluginManifest;
  plugin: Plugin;
};
