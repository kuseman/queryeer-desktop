import { contextBridge, ipcRenderer } from "electron";
import type {
  BackendGatewayStatus,
  FileBindParams,
  FileBindResult,
  FileChangeNotification,
  FileCloseParams,
  FileCloseResult,
  FileOpenParams,
  FileOpenResult,
  QueryCancelParams,
  QueryCancelResult,
  QueryExecuteParams,
  QueryExecuteResult
} from "../contracts/backend";
import type {
  FileWatcherEvent,
  FileWatcherWatchOptions
} from "../contracts/files/FileWatcher";
import type { ExternalFrontendPluginManifest } from "../contracts/plugin/ExternalFrontendPluginManifest";
import type { WorkspaceSnapshot } from "../contracts/workspace/WorkspaceSnapshot";
import type { UserKeybindingsDocument } from "../contracts/commands/Keybindings";

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

type AppShellApi = {
  platform: NodeJS.Platform;
  version: string;
  readFile: (uri: string) => Promise<{ success: boolean; content: string }>;
  writeFile: (uri: string, content: string) => Promise<{ success: boolean }>;
  getBackendStatus: () => Promise<BackendGatewayStatus>;
  getExternalFrontendPlugins: () => Promise<ExternalFrontendPluginManifest[]>;
  executeBackendQuery: (params: QueryExecuteParams) => Promise<QueryExecuteResult>;
  cancelBackendQuery: (params: QueryCancelParams) => Promise<QueryCancelResult>;
  openBackendFile: (params: FileOpenParams) => Promise<FileOpenResult>;
  closeBackendFile: (params: FileCloseParams) => Promise<FileCloseResult>;
  bindBackendFile: (params: FileBindParams) => Promise<FileBindResult>;
  notifyBackendFileChange: (params: FileChangeNotification) => Promise<void>;
  getWorkspace: () => Promise<WorkspaceSnapshot>;
  saveWorkspace: (snapshot: WorkspaceSnapshot) => Promise<{ accepted: boolean }>;
  getUserKeybindings: () => Promise<UserKeybindingsDocument>;
  saveUserKeybindings: (document: UserKeybindingsDocument) => Promise<{ accepted: boolean }>;
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
  windowMinimize: () => void;
  windowMaximize: () => void;
  windowClose: () => void;
  isWindowMaximized: () => Promise<boolean>;
  onWindowStateChanged: (listener: (state: { maximized: boolean }) => void) => () => void;
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
  getExternalFrontendPlugins: async () => {
    return ipcRenderer.invoke("plugins:get-frontend-targets");
  },
  executeBackendQuery: async (params) => {
    return ipcRenderer.invoke("backend:execute-query", params);
  },
  cancelBackendQuery: async (params) => {
    return ipcRenderer.invoke("backend:cancel-query", params);
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
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowMaximize: () => ipcRenderer.send("window:maximize"),
  windowClose: () => ipcRenderer.send("window:close"),
  isWindowMaximized: async () => {
    return ipcRenderer.invoke("window:is-maximized");
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
