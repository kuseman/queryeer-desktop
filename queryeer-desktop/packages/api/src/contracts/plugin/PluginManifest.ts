export type PluginKind = "core" | "feature";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  dependencies?: string[];
  providesCapabilities?: string[];
  requiredCapabilities?: string[];
  description?: string;
};

/**
 * An external plugin's frontend manifest. Its identity (`id`, `name`, `version`, `description`) is declared once, in
 * `plugin.json`, and the host fills it in. A built plugin that still sets these fields loads, but they are ignored.
 */
export type ExternalPluginManifest = Omit<PluginManifest, "id" | "name" | "version" | "description">;
