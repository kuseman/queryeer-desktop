import type { PluginManifestFile } from "../contracts/plugin/PluginManifestFile";
import coreCommandsManifest from "./manifests/core.commands.json";
import coreFilesManifest from "./manifests/core.files.json";
import coreFileSystemManifest from "./manifests/core.filesystem.json";
import coreFileWatcherManifest from "./manifests/core.fileWatcher.json";
import coreLayoutManifest from "./manifests/core.layout.json";

export function loadPluginManifests(): PluginManifestFile[] {
  return [
    coreLayoutManifest as PluginManifestFile,
    coreFileSystemManifest as PluginManifestFile,
    coreFileWatcherManifest as PluginManifestFile,
    coreFilesManifest as PluginManifestFile,
    coreCommandsManifest as PluginManifestFile
  ];
}
