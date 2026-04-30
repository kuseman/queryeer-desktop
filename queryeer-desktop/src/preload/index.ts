import { contextBridge, ipcRenderer } from "electron";
import type {
  BackendGatewayStatus,
  FileBindParams,
  FileBindResult,
  FileChangeNotification,
  FileCloseParams,
  FileCloseResult,
  EngineInvokeParams,
  EngineInvokeResult,
  FileOpenParams,
  FileOpenResult,
  QueryCancelParams,
  QueryCancelResult,
  QueryExecuteParams,
  QueryExecuteResult
} from "../contracts/backend/index.js";
import type {
  FileWatcherEvent,
  FileWatcherWatchOptions
} from "../contracts/files/FileWatcher.js";
import type { ExternalFrontendPluginManifest } from "../contracts/plugin/ExternalFrontendPluginManifest.js";
import type { WorkspaceSnapshot } from "../contracts/workspace/WorkspaceSnapshot.js";
import type { UserKeybindingsDocument } from "../contracts/commands/Keybindings.js";
import type {
  SettingsIndexDocument,
  SettingsModuleDocument
} from "../contracts/settings/SettingsDocuments.js";
import type {
  SecurityMasterPasswordStorage,
  SecurityStatus
} from "../contracts/security/Security.js";

type DialogShowMessageOptions = {
  title: string;
  message: string;
  severity?: "info" | "warning" | "error";
  detail?: string;
  options?: { label: string; value: string }[];
};

type DialogShowOpenOptions = {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  multiSelections?: boolean;
};

type DialogShowFolderOptions = {
  title?: string;
  defaultPath?: string;
};

type DialogShowSaveOptions = {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
};

type QueryEvent = { method: string; params: unknown };

type RecentFileEntry = {
  uri: string;
  lastOpenedAt: string;
};

type AppShellApi = {
  platform: NodeJS.Platform;
  version: string;
  readFile: (uri: string) => Promise<{ success: boolean; content: string }>;
  writeFile: (uri: string, content: string) => Promise<{ success: boolean }>;
  getBackendStatus: () => Promise<BackendGatewayStatus>;
  toggleBackendTrace: (enabled: boolean) => Promise<void>;
  setLogFlow: (enabled: boolean) => Promise<void>;
  clearBackendLogs: () => Promise<void>;
  getExternalFrontendPlugins: () => Promise<ExternalFrontendPluginManifest[]>;
  executeBackendQuery: (params: QueryExecuteParams) => Promise<QueryExecuteResult>;
  cancelBackendQuery: (params: QueryCancelParams) => Promise<QueryCancelResult>;
  invokeBackendEngine: (params: EngineInvokeParams) => Promise<EngineInvokeResult>;
  openBackendFile: (params: FileOpenParams) => Promise<FileOpenResult>;
  closeBackendFile: (params: FileCloseParams) => Promise<FileCloseResult>;
  bindBackendFile: (params: FileBindParams) => Promise<FileBindResult>;
  notifyBackendFileChange: (params: FileChangeNotification) => Promise<void>;
  getWorkspace: () => Promise<WorkspaceSnapshot>;
  saveWorkspace: (snapshot: WorkspaceSnapshot) => Promise<{ accepted: boolean }>;
  getUserKeybindings: () => Promise<UserKeybindingsDocument>;
  saveUserKeybindings: (document: UserKeybindingsDocument) => Promise<{ accepted: boolean }>;
  getSettingsIndex: () => Promise<SettingsIndexDocument>;
  getSettingsModule: (params: { moduleId: string }) => Promise<SettingsModuleDocument>;
  saveSettingsIndex: (document: SettingsIndexDocument) => Promise<{ accepted: boolean }>;
  saveSettingsModule: (params: { moduleId: string; document: SettingsModuleDocument }) => Promise<{ accepted: boolean }>;
  getSecurityStatus: () => Promise<SecurityStatus>;
  unlockSecurity: (params: {
    masterPassword: string;
    masterPasswordStorage: SecurityMasterPasswordStorage;
  }) => Promise<{ accepted: boolean; reason?: string }>;
  unlockSecurityWithStored: () => Promise<{ accepted: boolean; reason?: string }>;
  lockSecurity: () => Promise<{ accepted: boolean }>;
  storeSecret: (params: { plaintext: string; secretRef?: string }) => Promise<{ secretRef: string }>;
  resolveSecret: (params: { secretRef: string }) => Promise<{ found: boolean; plaintext?: string }>;
  deleteSecret: (params: { secretRef: string }) => Promise<{ deleted: boolean }>;
  rotateSecurityMasterPassword: (params: {
    oldMasterPassword: string;
    newMasterPassword: string;
    masterPasswordStorage: SecurityMasterPasswordStorage;
  }) => Promise<{ accepted: boolean; reason?: string }>;
  saveWorkspaceBackup: (params: {
    fileId: string;
    text: string;
  }) => Promise<{ backupUri: string }>;
  purgeWorkspaceBackups: (params: { fileId: string }) => Promise<{ purged: number }>;
  listWorkspaceBackups: (params: {
    fileId: string;
  }) => Promise<{ backupPaths: string[] }>;
  readLatestWorkspaceBackup: (params: {
    fileId: string;
  }) => Promise<{ text: string; savedAt: string; backupUri: string } | null>;
  readDir: (params: {
    uri: string;
  }) => Promise<{
    success: boolean;
    items: { name: string; isDirectory: boolean; isFile: boolean; size: number; modified: string }[];
  }>;
  getStat: (params: {
    uri: string;
  }) => Promise<{
    success: boolean;
    stat: { isDirectory: boolean; isFile: boolean; size: number; modified: string } | null;
  }>;
  watchFile: (params: {
    uri: string;
    options: FileWatcherWatchOptions;
  }) => Promise<{ subscriptionId: string }>;
  unwatchFile: (params: { subscriptionId: string }) => Promise<{ removed: boolean }>;
  muteFileWatcherPath: (params: { uri: string; durationMs: number }) => Promise<{ muted: boolean }>;
  onFileWatcherEvent: (
    listener: (params: { subscriptionId: string; event: FileWatcherEvent }) => void
  ) => () => void;
  onMenuExecuteCommand: (listener: (commandId: string) => void) => () => void;
  onQueryEvent: (listener: (event: QueryEvent) => void) => () => void;
  showDialogMessage: (options: DialogShowMessageOptions) => Promise<{ action: string }>;
  showDialogOpen: (options: DialogShowOpenOptions) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showOpenFolder: (options?: DialogShowFolderOptions) => Promise<{ canceled: boolean; folderPath?: string }>;
  showDialogSave: (options: DialogShowSaveOptions) => Promise<{ canceled: boolean; filePath?: string }>;
  buildMenu: (menuItems: unknown[], commands: unknown[]) => Promise<{ success: boolean }>;
  rebuildMenu: () => Promise<{ success: boolean }>;
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  isWindowMaximized: () => Promise<boolean>;
  isDev: () => Promise<boolean>;
  onWindowStateChanged: (listener: (state: { maximized: boolean }) => void) => () => void;
  zoomIn: () => Promise<void>;
  zoomOut: () => Promise<void>;
  zoomReset: () => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  cut: () => Promise<void>;
  copy: () => Promise<void>;
  paste: () => Promise<void>;
  selectAll: () => Promise<void>;
  reloadWindow: () => Promise<void>;
  forceReloadWindow: () => Promise<void>;
  toggleFullScreen: () => Promise<void>;
  toggleDevTools: () => Promise<void>;
  showItemInFolder: (uri: string) => Promise<{ success: boolean }>;
  openPath: (uri: string) => Promise<{ success: boolean; error?: string }>;
  getRecentFiles: () => Promise<RecentFileEntry[]>;
  addRecentFile: (uri: string, maxCount?: number) => Promise<{ accepted: boolean }>;
  removeRecentFile: (uri: string) => Promise<{ removed: boolean }>;
  clearRecentFiles: () => Promise<{ cleared: boolean }>;
  openExportStream: (params: { executionId: string; resultSetIndex: number }) => Promise<void>;
  appendExportChunk: (params: {
    executionId: string;
    resultSetIndex: number;
    rows: unknown[][];
  }) => Promise<void>;
  finalizeExportStream: (params: {
    executionId: string;
    resultSetIndex: number;
  }) => Promise<{ exportPath: string }>;
};

const appShellApi: AppShellApi = {
  platform: process.platform,
  version: "0.1.0",
  readFile: async (uri: string) => {
    return ipcRenderer.invoke("file:read", { uri });
  },
  writeFile: async (uri: string, content: string) => {
    return ipcRenderer.invoke("file:write", { uri, content });
  },
  getBackendStatus: async () => {
    return ipcRenderer.invoke("backend:get-status");
  },
  toggleBackendTrace: async (enabled: boolean) => {
    return ipcRenderer.invoke("backend:toggle-trace", enabled);
  },
  setLogFlow: async (enabled: boolean) => {
    return ipcRenderer.invoke("backend:set-log-flow", enabled);
  },
  clearBackendLogs: async () => {
    return ipcRenderer.invoke("backend:clear-logs");
  },
  getExternalFrontendPlugins: async () => {
    return ipcRenderer.invoke("plugins:get-frontend-targets");
  },
  executeBackendQuery: async (params) => {
    return ipcRenderer.invoke("backend:execute-query", params);
  },
  cancelBackendQuery: async (params) => {
    return ipcRenderer.invoke("backend:cancel-query", params);
  },
  invokeBackendEngine: async (params) => {
    return ipcRenderer.invoke("backend:engine-invoke", params);
  },
  openBackendFile: async (params) => {
    return ipcRenderer.invoke("backend:file-open", params);
  },
  closeBackendFile: async (params) => {
    return ipcRenderer.invoke("backend:file-close", params);
  },
  bindBackendFile: async (params) => {
    return ipcRenderer.invoke("backend:file-bind", params);
  },
  notifyBackendFileChange: async (params) => {
    return ipcRenderer.invoke("backend:file-change", params);
  },
  getWorkspace: async () => {
    return ipcRenderer.invoke("workspace:get");
  },
  saveWorkspace: async (snapshot) => {
    return ipcRenderer.invoke("workspace:save", snapshot);
  },
  getUserKeybindings: async () => {
    return ipcRenderer.invoke("keybindings:get");
  },
  saveUserKeybindings: async (document) => {
    return ipcRenderer.invoke("keybindings:save", document);
  },
  getSettingsIndex: async () => {
    return ipcRenderer.invoke("settings:get-index");
  },
  getSettingsModule: async (params) => {
    return ipcRenderer.invoke("settings:get-module", params);
  },
  saveSettingsIndex: async (document) => {
    return ipcRenderer.invoke("settings:save-index", document);
  },
  saveSettingsModule: async (params) => {
    return ipcRenderer.invoke("settings:save-module", params);
  },
  getSecurityStatus: async () => {
    return ipcRenderer.invoke("security:get-status");
  },
  unlockSecurity: async (params) => {
    return ipcRenderer.invoke("security:unlock", params);
  },
  unlockSecurityWithStored: async () => {
    return ipcRenderer.invoke("security:unlock-with-stored");
  },
  lockSecurity: async () => {
    return ipcRenderer.invoke("security:lock");
  },
  storeSecret: async (params) => {
    return ipcRenderer.invoke("security:store-secret", params);
  },
  resolveSecret: async (params) => {
    return ipcRenderer.invoke("security:resolve-secret", params);
  },
  deleteSecret: async (params) => {
    return ipcRenderer.invoke("security:delete-secret", params);
  },
  rotateSecurityMasterPassword: async (params) => {
    return ipcRenderer.invoke("security:rotate-master-password", params);
  },
  saveWorkspaceBackup: async (params) => {
    return ipcRenderer.invoke("workspace:save-backup", params);
  },
  purgeWorkspaceBackups: async (params) => {
    return ipcRenderer.invoke("workspace:purge-backups", params);
  },
  listWorkspaceBackups: async (params) => {
    return ipcRenderer.invoke("workspace:list-backups", params);
  },
  readLatestWorkspaceBackup: async (params) => {
    return ipcRenderer.invoke("workspace:read-backup", params);
  },
  readDir: async (params) => {
    return ipcRenderer.invoke("fs:read-dir", params);
  },
  getStat: async (params) => {
    return ipcRenderer.invoke("fs:get-stat", params);
  },
  watchFile: async (params) => {
    return ipcRenderer.invoke("file-watcher:watch", params);
  },
  unwatchFile: async (params) => {
    return ipcRenderer.invoke("file-watcher:unwatch", params);
  },
  muteFileWatcherPath: async (params) => {
    return ipcRenderer.invoke("file-watcher:mute", params);
  },
  onFileWatcherEvent: (listener) => {
    const channel = "file-watcher:event";
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { subscriptionId: string; event: FileWatcherEvent }
    ): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  },
  onMenuExecuteCommand: (listener: (commandId: string) => void) => {
    const channel = "menu:execute-command";
    const wrapped = (_event: Electron.IpcRendererEvent, commandId: string): void => {
      listener(commandId);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  },
  onQueryEvent: (listener: (event: QueryEvent) => void) => {
    const channel = "query:event";
    const wrapped = (_event: Electron.IpcRendererEvent, payload: QueryEvent): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  },
  showDialogMessage: async (options) => {
    return ipcRenderer.invoke("dialog:show-message", options);
  },
  showDialogOpen: async (options) => {
    return ipcRenderer.invoke("dialog:show-open", options);
  },
  showOpenFolder: async (options) => {
    return ipcRenderer.invoke("dialog:show-open-folder", options);
  },
  showDialogSave: async (options) => {
    return ipcRenderer.invoke("dialog:show-save", options);
  },
  buildMenu: async (menuItems: unknown[], commands: unknown[]) => {
    return ipcRenderer.invoke("menu:build", menuItems, commands);
  },
  rebuildMenu: async () => {
    return ipcRenderer.invoke("menu:rebuild");
  },
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowMaximize: () => ipcRenderer.send("window:maximize"),
  windowClose: () => ipcRenderer.send("window:close"),
  isWindowMaximized: async () => {
    return ipcRenderer.invoke("window:is-maximized");
  },
  isDev: async () => {
    return ipcRenderer.invoke("app:is-dev");
  },
  zoomIn: async () => {
    return ipcRenderer.invoke("window:zoom-in");
  },
  zoomOut: async () => {
    return ipcRenderer.invoke("window:zoom-out");
  },
  zoomReset: async () => {
    return ipcRenderer.invoke("window:zoom-reset");
  },
  undo: async () => {
    return ipcRenderer.invoke("window:undo");
  },
  redo: async () => {
    return ipcRenderer.invoke("window:redo");
  },
  cut: async () => {
    return ipcRenderer.invoke("window:cut");
  },
  copy: async () => {
    return ipcRenderer.invoke("window:copy");
  },
  paste: async () => {
    return ipcRenderer.invoke("window:paste");
  },
  selectAll: async () => {
    return ipcRenderer.invoke("window:select-all");
  },
  reloadWindow: async () => {
    return ipcRenderer.invoke("window:reload");
  },
  forceReloadWindow: async () => {
    return ipcRenderer.invoke("window:force-reload");
  },
  toggleFullScreen: async () => {
    return ipcRenderer.invoke("window:toggle-full-screen");
  },
  toggleDevTools: async () => {
    return ipcRenderer.invoke("window:toggle-dev-tools");
  },
  showItemInFolder: async (uri: string) => {
    return ipcRenderer.invoke("shell:show-item-in-folder", { uri });
  },
  openPath: async (uri: string) => {
    return ipcRenderer.invoke("shell:open-path", { uri });
  },
  getRecentFiles: async () => {
    return ipcRenderer.invoke("recent:get");
  },
  addRecentFile: async (uri: string, maxCount?: number) => {
    return ipcRenderer.invoke("recent:add", { uri, maxCount });
  },
  removeRecentFile: async (uri: string) => {
    return ipcRenderer.invoke("recent:remove", { uri });
  },
  clearRecentFiles: async () => {
    return ipcRenderer.invoke("recent:clear");
  },
  openExportStream: async (params) => {
    return ipcRenderer.invoke("workspace:export-open", params);
  },
  appendExportChunk: async (params) => {
    return ipcRenderer.invoke("workspace:export-append", params);
  },
  finalizeExportStream: async (params) => {
    return ipcRenderer.invoke("workspace:export-finalize", params);
  },
  onWindowStateChanged: (listener) => {
    const channel = "window:state-changed";
    const wrapped = (_event: Electron.IpcRendererEvent, payload: { maximized: boolean }): void => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  }
};

contextBridge.exposeInMainWorld("appShell", appShellApi);
