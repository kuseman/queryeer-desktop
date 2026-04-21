import { PluginHost } from "../../core/plugin-runtime/PluginHost";
import type { FileBackendSync } from "../../core/plugin-runtime/FileMediator";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { toPluginManifestFile } from "../../contracts/plugin/PluginManifestFile";
import { RendererFileWatcherService } from "../file-watcher/file-watcher-service";
import { RendererWorkspaceService } from "../workspace/workspace-service";
import { discoverPluginModules } from "../../plugins/discovery";

export async function bootstrapShell() {
  const backendSync: FileBackendSync = {
    openFile: async (file, initialText) => {
      if (!file.engineBinding) {
        return;
      }
      await window.appShell.openBackendFile({
        fileId: file.fileId,
        uri: file.uri,
        mimeType: file.mimeType,
        engineBinding: file.engineBinding,
        initialText
      });
    },
    closeFile: async (file) => {
      await window.appShell.closeBackendFile({ fileId: file.fileId });
    },
    bindFile: async (file) => {
      if (!file.engineBinding) {
        return;
      }
      await window.appShell.bindBackendFile({
        fileId: file.fileId,
        engineId: file.engineBinding.engineId,
        connectionId: file.engineBinding.connectionId
      });
    },
    changeFile: async (file, text) => {
      await window.appShell.notifyBackendFileChange({
        fileId: file.fileId,
        version: file.version,
        text
      });
    }
  };

  const fileWatcher = new RendererFileWatcherService({
    watchFile: (params) => window.appShell.watchFile(params),
    unwatchFile: (params) => window.appShell.unwatchFile(params),
    muteFileWatcherPath: (params) => window.appShell.muteFileWatcherPath(params),
    onFileWatcherEvent: (listener) => window.appShell.onFileWatcherEvent(listener)
  });

  let workspaceService: RendererWorkspaceService | null = null;
  const onFileChanged = (file: FileEntity, text: string): void => {
    workspaceService?.handleFileChanged(file, text);
  };

  const host = new PluginHost({
    executeBackendQuery: (params) => window.appShell.executeBackendQuery(params),
    fileWatcher,
    backendSync,
    onFileChanged
  });

  const externalFrontendPlugins = await window.appShell.getExternalFrontendPlugins();
  const externalManifests = externalFrontendPlugins.map(toPluginManifestFile);

  const discovery = await discoverPluginModules(externalManifests);
  for (const pluginModule of discovery.modules) {
    host.register(pluginModule.plugin);
  }

  await host.start(discovery.manifests);
  host.setExternalLoadErrors(discovery.loadErrors);

  workspaceService = new RendererWorkspaceService({
    bridge: {
      getWorkspace: () => window.appShell.getWorkspace(),
      saveWorkspace: (snapshot) => window.appShell.saveWorkspace(snapshot),
      saveBackup: (fileId, text) =>
        window.appShell.saveWorkspaceBackup({ fileId, text }),
      purgeBackups: (fileId) => window.appShell.purgeWorkspaceBackups({ fileId }),
      listBackups: (fileId) => window.appShell.listWorkspaceBackups({ fileId }),
      readLatestBackup: (fileId) =>
        window.appShell.readLatestWorkspaceBackup({ fileId })
    },
    filesRegistry: host.getFilesRegistry(),
    fileMediator: host.getFileMediator(),
    fileWatcher
  });
  await workspaceService.hydrate();

  const commandExecution = await host.executeCommand("core.commands.about");

  return {
    hostState: host.getState(),
    extensions: host.getExtensions(),
    filesRegistry: host.getFilesRegistry(),
    fileMediator: host.getFileMediator(),
    workspaceService,
    commandExecution,
    diagnostics: host.getDiagnostics()
  };
}
