import type { PluginManifest } from "./PluginManifest";
import type { Plugin } from "./Plugin";

export type PluginModule = {
  manifest: PluginManifest;
  plugin: Plugin;
};
