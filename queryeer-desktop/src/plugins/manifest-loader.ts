import type { PluginManifestFile } from "../contracts/plugin/PluginManifestFile";
import coreCommandsManifest from "./manifests/core.commands.json";
import coreFileSystemManifest from "./manifests/core.filesystem.json";
import coreLayoutManifest from "./manifests/core.layout.json";

export function loadPluginManifests(): PluginManifestFile[] {
  return [
    coreLayoutManifest as PluginManifestFile,
    coreFileSystemManifest as PluginManifestFile,
    coreCommandsManifest as PluginManifestFile
  ];
}
