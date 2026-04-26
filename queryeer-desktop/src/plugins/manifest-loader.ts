import type { PluginManifestFile } from "../contracts/plugin/PluginManifestFile";
import coreCommandsManifest from "./manifests/core.commands.json";
import coreSettingsManifest from "./manifests/core.settings.json";
import coreDialogManifest from "./manifests/core.dialog.json";
import coreEditorManifest from "./manifests/core.editor.json";
import coreExplorerManifest from "./manifests/core.explorer.json";
import coreFileSystemManifest from "./manifests/core.filesystem.json";
import coreFileWatcherManifest from "./manifests/core.fileWatcher.json";
import coreFilesManifest from "./manifests/core.files.json";
import coreLayoutManifest from "./manifests/core.layout.json";
import coreMenuManifest from "./manifests/core.menu.json";
import coreObservabilityManifest from "./manifests/core.observability.json";
import coreWorkspaceManifest from "./manifests/core.workspace.json";
import coreQueryEngineManifest from "./manifests/core.queryengine.json";
import coreQueryEnginePayloadbuilderManifest from "./manifests/core.queryengine.payloadbuilder.json";
import coreQueryEnginePayloadbuilderElasticsearchManifest from "./manifests/core.queryengine.payloadbuilder.elasticsearch.json";
import coreQueryEngineOutputTextManifest from "./manifests/core.queryengine.output.text.json";

export function loadPluginManifests(): PluginManifestFile[] {
  return [
    coreLayoutManifest as PluginManifestFile,
    coreEditorManifest as PluginManifestFile,
    coreMenuManifest as PluginManifestFile,
    coreObservabilityManifest as PluginManifestFile,
    coreFileSystemManifest as PluginManifestFile,
    coreFileWatcherManifest as PluginManifestFile,
    coreFilesManifest as PluginManifestFile,
    coreDialogManifest as PluginManifestFile,
    coreWorkspaceManifest as PluginManifestFile,
    coreCommandsManifest as PluginManifestFile,
    coreSettingsManifest as PluginManifestFile,
    coreExplorerManifest as PluginManifestFile,
    coreQueryEngineManifest as PluginManifestFile,
    coreQueryEnginePayloadbuilderManifest as PluginManifestFile,
    coreQueryEnginePayloadbuilderElasticsearchManifest as PluginManifestFile,
    coreQueryEngineOutputTextManifest as PluginManifestFile
  ];
}
