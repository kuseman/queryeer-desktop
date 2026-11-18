export type ExternalFrontendPluginManifest = {
  id: string;
  name: string;
  version: string;
  /** From `plugin.json`, when it has one. */
  description?: string;
  modulePath: string;
  sourcePath: string;
};
