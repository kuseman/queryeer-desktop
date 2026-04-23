import { PluginHost } from "../../core/plugin-runtime/PluginHost";
import type { FileBackendSync } from "../../core/plugin-runtime/FileMediator";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { toPluginManifestFile } from "../../contracts/plugin/PluginManifestFile";
import { RendererFileWatcherService } from "../file-watcher/file-watcher-service";
import { RendererWorkspaceService } from "../workspace/workspace-service";
import { discoverPluginModules } from "../../plugins/discovery";
import { setRuntimeData } from "../../plugins/core.observability/runtime-data";
import { createKeybindingService } from "../../plugins/core.commands/keybinding-service";
import {
  resolveKeybindingState
} from "../../plugins/core.commands/keybinding-resolver";
import { getTextEditorRegistry } from "../../plugins/core.editor/TextEditor/TextEditorRegistry";

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

  const resolveFileContent = (fileId: string, uri: string): string | undefined => {
    const textEditorRegistry = getTextEditorRegistry();
    const model = textEditorRegistry.getModelForFile(fileId)
      ?? textEditorRegistry.getModelForUri(uri);
    return model?.getContent();
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
    onFileChanged,
    writeFile: (uri, text) => window.appShell.writeFile(uri, text),
    resolveFileContent,
    showSaveDialog: (options) => window.appShell.showDialogSave(options)
  });

  const externalFrontendPlugins = await window.appShell.getExternalFrontendPlugins();
  const externalManifests = externalFrontendPlugins.map(toPluginManifestFile);

  const discovery = await discoverPluginModules(externalManifests);
  for (const pluginModule of discovery.modules) {
    host.register(pluginModule.plugin);
  }

  await host.start(discovery.manifests);
  host.setExternalLoadErrors(discovery.loadErrors);

  const keybindingService = createKeybindingService({
    executeCommand: (commandId) => host.executeCommand(commandId),
    getUserKeybindings: () => window.appShell.getUserKeybindings()
  });
  await keybindingService.initialize(host.getExtensions());

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

  window.appShell.onMenuExecuteCommand((commandId: string) => {
    void host.executeCommand(commandId);
  });

  const extensions = host.getExtensions();
  const menuItems = extensions.menu.items.map((item) => ({
    id: item.id,
    label: item.label,
    order: item.order,
    commandId: item.commandId,
    parentId: item.parentId,
    icon: item.icon
  }));

  const fallbackMenuAccelerators = new Map<string, string>();
  const keybindingState = resolveKeybindingState(
    extensions,
    await window.appShell.getUserKeybindings()
  );
  for (const contribution of [...keybindingState.resolved].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const isGlobalScope = (contribution.scope ?? "global") === "global";
    const isGlobalWhen = contribution.when === undefined || contribution.when === "global";
    if (!isGlobalScope || !isGlobalWhen) {
      continue;
    }
    if (!fallbackMenuAccelerators.has(contribution.commandId)) {
      fallbackMenuAccelerators.set(contribution.commandId, contribution.key);
    }
  }

  const commands = extensions.commands.map((cmd) => ({
    id: cmd.id,
    accelerator: fallbackMenuAccelerators.get(cmd.id)
  }));

  try {
    await window.appShell.buildMenu(menuItems, commands);
  } catch (err) {
    console.error("Failed to build menu:", err);
  }

  setRuntimeData({
    hostState: host.getState(),
    diagnostics: host.getDiagnostics(),
    extensions: host.getExtensions(),
    keybindingDiagnostics: keybindingService.diagnostics(),
    commandExecution
  });

  return {
    hostState: host.getState(),
    extensions: host.getExtensions(),
    filesRegistry: host.getFilesRegistry(),
    fileMediator: host.getFileMediator(),
    workspaceService,
    commandExecution,
    executeCommand: (commandId: string) => host.executeCommand(commandId),
    diagnostics: host.getDiagnostics()
  };
}
