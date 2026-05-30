import type { PluginKind } from "@queryeer/api/plugin/PluginManifest";
import type { PluginManifestFile } from "@queryeer/api/plugin/PluginManifestFile";

const validPluginKinds: PluginKind[] = ["core", "feature"];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function validatePluginManifestFile(manifest: PluginManifestFile): void {
  if (!manifest.id || typeof manifest.id !== "string") {
    throw new Error("Plugin manifest id must be a non-empty string");
  }
  if (!manifest.name || typeof manifest.name !== "string") {
    throw new Error(`Plugin '${manifest.id}' has invalid name`);
  }
  if (!manifest.version || typeof manifest.version !== "string") {
    throw new Error(`Plugin '${manifest.id}' has invalid version`);
  }
  if (!validPluginKinds.includes(manifest.kind)) {
    throw new Error(`Plugin '${manifest.id}' has invalid kind '${manifest.kind}'`);
  }
  if (!manifest.modulePath || typeof manifest.modulePath !== "string") {
    throw new Error(`Plugin '${manifest.id}' has invalid modulePath`);
  }
  if (manifest.dependencies && !isStringArray(manifest.dependencies)) {
    throw new Error(`Plugin '${manifest.id}' has invalid dependencies`);
  }
  if (
    manifest.providesCapabilities &&
    !isStringArray(manifest.providesCapabilities)
  ) {
    throw new Error(`Plugin '${manifest.id}' has invalid providesCapabilities`);
  }
  if (
    manifest.requiredCapabilities &&
    !isStringArray(manifest.requiredCapabilities)
  ) {
    throw new Error(`Plugin '${manifest.id}' has invalid requiredCapabilities`);
  }
}

export function validatePluginManifestFiles(manifests: PluginManifestFile[]): void {
  const ids = new Set<string>();

  for (const manifest of manifests) {
    validatePluginManifestFile(manifest);

    if (ids.has(manifest.id)) {
      throw new Error(`Duplicate manifest id '${manifest.id}'`);
    }
    ids.add(manifest.id);
  }
}
