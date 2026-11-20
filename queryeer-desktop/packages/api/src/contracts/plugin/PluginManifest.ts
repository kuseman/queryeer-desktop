export type PluginKind = "core" | "feature";

/**
 * A dependency on another frontend plugin: the plugin activates after it. A required dependency that is missing,
 * skipped or fails skips this plugin. An optional one (since 0.21) is used when it is there and activates; check
 * `context.isDependencyActive(id)` before using what it contributes.
 */
export type PluginDependency = {
  id: string;
  optional?: boolean;
};

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  /** Plugin ids (required dependencies) or `{ id, optional }` entries. */
  dependencies?: (string | PluginDependency)[];
  providesCapabilities?: string[];
  requiredCapabilities?: string[];
  description?: string;
};

/**
 * An external plugin's frontend manifest. Its identity (`id`, `name`, `version`, `description`) is declared once, in
 * `plugin.json`, and the host fills it in. A built plugin that still sets these fields loads, but they are ignored.
 */
export type ExternalPluginManifest = Omit<PluginManifest, "id" | "name" | "version" | "description">;
