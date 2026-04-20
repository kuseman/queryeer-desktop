import { contextBridge, ipcRenderer } from "electron";
import type {
  BackendGatewayStatus,
  QueryCancelParams,
  QueryCancelResult,
  QueryExecuteParams,
  QueryExecuteResult
} from "../contracts/backend";
import type { ExternalFrontendPluginManifest } from "../contracts/plugin/ExternalFrontendPluginManifest";

type AppShellApi = {
  platform: NodeJS.Platform;
  version: string;
  getBackendStatus: () => Promise<BackendGatewayStatus>;
  getExternalFrontendPlugins: () => Promise<ExternalFrontendPluginManifest[]>;
  executeBackendQuery: (params: QueryExecuteParams) => Promise<QueryExecuteResult>;
  cancelBackendQuery: (params: QueryCancelParams) => Promise<QueryCancelResult>;
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
  }
};

contextBridge.exposeInMainWorld("appShell", appShellApi);
