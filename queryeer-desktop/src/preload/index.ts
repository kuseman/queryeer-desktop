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

type AppShellApi = {
  platform: NodeJS.Platform;
  version: string;
  getBackendStatus: () => Promise<BackendGatewayStatus>;
  getExternalFrontendPlugins: () => Promise<ExternalFrontendPluginManifest[]>;
  executeBackendQuery: (params: QueryExecuteParams) => Promise<QueryExecuteResult>;
  cancelBackendQuery: (params: QueryCancelParams) => Promise<QueryCancelResult>;
  openBackendFile: (params: FileOpenParams) => Promise<FileOpenResult>;
  closeBackendFile: (params: FileCloseParams) => Promise<FileCloseResult>;
  bindBackendFile: (params: FileBindParams) => Promise<FileBindResult>;
  notifyBackendFileChange: (params: FileChangeNotification) => Promise<void>;
  watchFile: (params: {
    uri: string;
    options: FileWatcherWatchOptions;
  }) => Promise<{ subscriptionId: string }>;
  unwatchFile: (params: { subscriptionId: string }) => Promise<{ removed: boolean }>;
  muteFileWatcherPath: (params: { uri: string; durationMs: number }) => Promise<{ muted: boolean }>;
  onFileWatcherEvent: (
    listener: (params: { subscriptionId: string; event: FileWatcherEvent }) => void
  ) => () => void;
};

const appShellApi: AppShellApi = {
  platform: process.platform,
  version: "0.1.0",
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
  }
};

contextBridge.exposeInMainWorld("appShell", appShellApi);
