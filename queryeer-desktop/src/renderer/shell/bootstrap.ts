import { PluginHost } from "../../core/plugin-runtime/PluginHost";
import type { FileBackendSync } from "../../core/plugin-runtime/FileMediator";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { toPluginManifestFile } from "../../contracts/plugin/PluginManifestFile";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import { RendererFileWatcherService } from "../file-watcher/file-watcher-service";
import { RendererWorkspaceService } from "../workspace/workspace-service";
import { discoverPluginModules } from "../../plugins/discovery";
import { setRuntimeData } from "../../plugins/core.observability/runtime-data";
import { createKeybindingService } from "../../plugins/core.commands/keybinding-service";
import {
  resolveKeybindingState
} from "../../plugins/core.commands/keybinding-resolver";
import { setTextEditorContextChain } from "../../plugins/core.editor/TextEditor/TextEditorRegistry";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { createBackendCommandContext } from "./backend-command-context";
import { filterMenuItemsByWhen } from "../../plugins/core.menu/menu-item-filter";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { FileMediator } from "../../contracts/files/FileMediator";
import { flattenContextObject } from "./context-value-flatten";
import { createContextChain } from "../../plugins/core.commands/context-chain";
import { ContextPriority } from "../../plugins/core.commands/context-priority";
import { createZoneFocusScope } from "../../plugins/core.commands/context-key-service";
import { initializeQuickCommandService } from "../../plugins/core.quickcommand/service";
import { requestMessageDialog } from "../../plugins/core.dialog/message-dialog-service";

export async function bootstrapShell() {
  const chain = createContextChain();

  // Backend health context as the base workbench scope.
  const commandContext = createBackendCommandContext();
  chain.register({ id: "backend", priority: ContextPriority.WORKBENCH, context: {} });
  await commandContext.initialize();
  chain.update("backend", commandContext.snapshot());
  commandContext.onDidChange(() => chain.update("backend", commandContext.snapshot()));

  // UI zone focus tracking (editorFocus, terminalFocus, inputFocus, …).
  createZoneFocusScope(chain);

  // Wire all TextEditorRegistry instances so they can register EDITOR_INSTANCE scopes.
  setTextEditorContextChain(chain);

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
    changeFile: async (file, text) => {
      await window.appShell.notifyBackendFileChange({
        fileId: file.fileId,
        version: file.version,
        text
      });
    }
  };

  const resolveFileContent = (fileId: string, uri: string): string | undefined => {
    return getEditorRegistryHost().resolveFileContent(fileId, uri);
  };

  const fileWatcher = new RendererFileWatcherService({
    watchFile: (params) => window.appShell.watchFile(params),
    unwatchFile: (params) => window.appShell.unwatchFile(params),
    muteFileWatcherPath: (params) => window.appShell.muteFileWatcherPath(params),
    onFileWatcherEvent: (listener) => window.appShell.onFileWatcherEvent(listener)
  });

  let workspaceService: RendererWorkspaceService | null = null;
  let filesRegistry: FilesRegistry | null = null;
  let fileMediator: FileMediator | null = null;

  const onFileChanged = (file: FileEntity, text: string): void => {
    getEditorRegistryHost().broadcastContentUpdate(file.uri, text);
    workspaceService?.handleFileChanged(file, text);
  };

  const host = new PluginHost({
    fileWatcher,
    backendSync,
    onFileChanged,
    writeFile: (uri, text) => window.appShell.writeFile(uri, text),
    readFile: (uri) => window.appShell.readFile(uri),
    muteFileWatcherPath: (uri, durationMs) => fileWatcher.mutePath(uri, durationMs),
    resolveFileContent,
    showSaveDialog: (options) => window.appShell.showDialogSave(options),
    getCommandContextValues: () => {
      const activeFileId = fileMediator?.getActiveFileId() ?? null;
      const activeFile = activeFileId ? filesRegistry?.getFile(activeFileId) : undefined;
      const isQueryExecutable = activeFile
        ? filesRegistry?.capabilities.hasCapability(activeFile.mimeType, "queryexecutable") === true
        : false;
      const metadataContext = flattenContextObject("activeFileMetadata", activeFile?.metadata);
      return {
        ...chain.getEffectiveContext(),
        hasActiveQueryExecutableFile: isQueryExecutable,
        ...metadataContext
      };
    }
  });

  filesRegistry = host.getFilesRegistry();
  fileMediator = host.getFileMediator();

  const externalFrontendPlugins = await window.appShell.getExternalFrontendPlugins();
  const externalManifests = externalFrontendPlugins.map(toPluginManifestFile);

  const discovery = await discoverPluginModules(externalManifests);
  for (const pluginModule of discovery.modules) {
    host.register(pluginModule.plugin);
  }

  await host.start(discovery.manifests);
  host.setExternalLoadErrors(discovery.loadErrors);

  initializeQuickCommandService(host.getQuickCommandProviders(), () => chain.getEffectiveContext());

  const rebuildNativeMenu = async (): Promise<void> => {
    const extensions = host.getExtensions();
    const menuItems = filterMenuItemsByWhen(extensions.menu.items, commandContext.snapshot()).map((item) => ({
      id: item.id,
      label: item.label,
      type: item.type,
      order: item.order,
      commandId: item.commandId,
      parentId: item.parentId,
      when: item.when,
      icon: item.icon,
      accelerator: item.accelerator,
      role: item.role
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
    await window.appShell.buildMenu(menuItems, commands);
  };

  const extensions = host.getExtensions();
  const menuExt = extensions.menu as unknown as { onRebuild: (fn: () => Promise<void>) => void };
  menuExt.onRebuild(rebuildNativeMenu);

  await host.rebuildMenu();
  await rebuildNativeMenu();

  const executeCommand = async (commandId: string): Promise<CommandExecutionResult> => {
    const result = await host.executeCommand(commandId);
    if (result.executed) {
      return result;
    }
    if (result.reason === "disabled-by-enablement" && !commandContext.snapshot().backendHealthy) {
      await requestMessageDialog({
        title: "Backend not ready",
        message: "Backend is not up and running yet. Please wait a moment and try again.",
        severity: "warning"
      });
    }
    return result;
  };

  const keybindingService = createKeybindingService({
    executeCommand: async (commandId): Promise<CommandExecutionResult> => {
      return executeCommand(commandId);
    },
    getUserKeybindings: () => window.appShell.getUserKeybindings(),
    contextChain: chain
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
    filesRegistry: filesRegistry!,
    fileMediator: fileMediator!,
    fileWatcher,
    editorRegistryHost: getEditorRegistryHost(),
    showDialog: (options) => window.appShell.showDialogMessage(options),
    applyRecoveredContent: (fileId, text) => {
      getEditorRegistryHost().applyRecoveredContent(fileId, text);
    }
  });
  await workspaceService.hydrate();

  getEditorRegistryHost().onContentDirty((fileId, text) => {
    const file = filesRegistry!.getFile(fileId);
    if (file) {
      workspaceService?.handleFileChanged(file, text);
    }
  });

  const commandExecution = await executeCommand("core.commands.about");

  window.appShell.onMenuExecuteCommand((commandId: string) => {
    void executeCommand(commandId);
  });

  const handleZoomKeyboard = (event: KeyboardEvent) => {
    const isCtrlOrMeta = event.ctrlKey || event.metaKey;
    if (!isCtrlOrMeta) {
      return;
    }
    if (event.key === "=" || event.key === "+") {
      event.preventDefault();
      void window.appShell.zoomIn();
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      void window.appShell.zoomOut();
    } else if (event.key === "0") {
      event.preventDefault();
      void window.appShell.zoomReset();
    }
  };
  document.addEventListener("keydown", handleZoomKeyboard);

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
    filesRegistry,
    fileMediator,
    workspaceService,
    commandExecution,
    executeCommand,
    canExecuteCommand: (commandId: string) => host.canExecuteCommand(commandId),
    onCommandContextChanged: (listener: () => void) => chain.onDidChange(listener),
    diagnostics: host.getDiagnostics()
  };
}
