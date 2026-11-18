import type { ExternalPluginManifest, PluginManifest } from "./PluginManifest.js";
import type { Plugin } from "./Plugin.js";

export type PluginModule = {
  manifest: PluginManifest;
  plugin: Plugin;
};

/** A plugin whose identity comes from its `plugin.json` (see `ExternalPluginManifest`). */
export type ExternalPlugin = Omit<Plugin, "manifest"> & {
  manifest: ExternalPluginManifest;
};

/**
 * What an external plugin's frontend module exports as `pluginModule`. The host fills the identity from `plugin.json`
 * into both manifests before activating it.
 */
export type ExternalPluginModule = {
  manifest: ExternalPluginManifest;
  plugin: ExternalPlugin;
};
