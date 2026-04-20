import type { PluginManifest } from "./PluginManifest";
import type { ExternalFrontendPluginManifest } from "./ExternalFrontendPluginManifest";

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
