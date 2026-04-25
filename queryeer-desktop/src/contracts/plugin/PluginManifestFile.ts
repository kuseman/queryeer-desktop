import type { PluginManifest } from "./PluginManifest.js";
import type { ExternalFrontendPluginManifest } from "./ExternalFrontendPluginManifest.js";

export type PluginManifestFile = PluginManifest & {
  modulePath: string;
};

export function toPluginManifestFile(
  external: ExternalFrontendPluginManifest
): PluginManifestFile {
  return {
    id: external.id,
    name: external.name,
    version: external.version,
    kind: "feature",
    modulePath: external.modulePath
  };
}
