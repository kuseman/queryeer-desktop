import type { BackendGatewayStatus } from "../backend/index.js";
export type { BackendGatewayStatus };
import type { QueryExecuteOptions } from "../backend/Types.js";
import type { WorkspaceSnapshot } from "../workspace/WorkspaceSnapshot.js";
import type { UserKeybindingsDocument } from "../commands/Keybindings.js";
import type { ExternalFrontendPluginManifest } from "../plugin/ExternalFrontendPluginManifest.js";
import type { FileWatcherEvent } from "../files/FileWatcher.js";
import type {
  SettingsIndexDocument,
  SettingsModuleDocument
} from "../settings/SettingsDocuments.js";
import type {
  SecurityMasterPasswordStorage,
  SecurityStatus
} from "../security/Security.js";

type RecentFileEntry = {
  uri: string;
  lastOpenedAt: string;
};

export type { RecentFileEntry };

export interface ShellApi {
  platform: string;
  version: string;
  readFile: (uri: string) => Promise<{ success: boolean; content: string }>;
  writeFile: (uri: string, content: string) => Promise<{ success: boolean }>;
  getBackendStatus: () => Promise<BackendGatewayStatus>;
  toggleBackendTrace: (enabled: boolean) => Promise<void>;
  setLogFlow: (enabled: boolean) => Promise<void>;
  clearBackendLogs: () => Promise<void>;
  getMemoryUsage: () => Promise<{ heapUsed: number; heapTotal: number; rss: number }>;
  getAboutMetadata: () => Promise<{ appVersion: string; electronVersion: string; chromiumVersion: string; nodeVersion: string; platform: string; arch: string }>;
  getDesktopChangelog: () => Promise<string | null>;
  fetchQueryeerReleases: () => Promise<{ ok: boolean; releases: unknown }>;
  fetchBackendPluginChangelogs: () => Promise<{ plugins: Array<{ pluginId: string; pluginName: string; version: string; changelog: string }> }>;
  getExternalFrontendPlugins: () => Promise<ExternalFrontendPluginManifest[]>;
  executeBackendQuery: (params: {
    queryExecutionId: string;
    engineId: string;
    fileId: string;
    text: string;
    engineState?: unknown;
    options?: QueryExecuteOptions;
  }) => Promise<{ accepted: boolean; queryExecutionId: string }>;
  cancelBackendQuery: (params: {
    queryExecutionId: string;
    reason?: string;
  }) => Promise<{ accepted: boolean; queryExecutionId: string }>;
  invokeBackendEngine: (params: {
    engineId: string;
    fileId?: string;
    action: string;
    payload?: unknown;
  }) => Promise<{ result?: unknown; error?: { code: string; message: string } }>;
  getWorkspace: () => Promise<WorkspaceSnapshot>;
  saveWorkspace: (snapshot: WorkspaceSnapshot) => Promise<{ accepted: boolean }>;
  getUserKeybindings: () => Promise<UserKeybindingsDocument>;
  saveUserKeybindings: (document: UserKeybindingsDocument) => Promise<{ accepted: boolean }>;
  getSettingsIndex: () => Promise<SettingsIndexDocument>;
  getSettingsModule: (params: { moduleId: string }) => Promise<SettingsModuleDocument>;
  saveSettingsIndex: (document: SettingsIndexDocument) => Promise<{ accepted: boolean }>;
  saveSettingsModule: (params: { moduleId: string; document: SettingsModuleDocument }) => Promise<{ accepted: boolean }>;
  getSecurityStatus: () => Promise<SecurityStatus>;
  unlockSecurity: (params: { masterPassword: string; masterPasswordStorage: SecurityMasterPasswordStorage }) => Promise<{ accepted: boolean; reason?: string }>;
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
  saveWorkspaceBackup: (params: { fileId: string; text: string }) => Promise<{ backupUri: string }>;
  purgeWorkspaceBackups: (params: { fileId: string }) => Promise<{ purged: number }>;
  listWorkspaceBackups: (params: { fileId: string }) => Promise<{ backupPaths: string[] }>;
  readLatestWorkspaceBackup: (params: { fileId: string }) => Promise<{ text: string; savedAt: string; backupUri: string } | null>;
  readDir: (params: { uri: string }) => Promise<{ success: boolean; items: { name: string; isDirectory: boolean; isFile: boolean; size: number; modified: string }[] }>;
  getStat: (params: { uri: string }) => Promise<{ success: boolean; stat: { isDirectory: boolean; isFile: boolean; size: number; modified: string } | null }>;
  showDialogMessage: (options: { title: string; message: string; severity?: "info" | "warning" | "error"; detail?: string; options?: { label: string; value: string }[] }) => Promise<{ action: string }>;
  showDialogOpen: (options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[]; multiSelections?: boolean }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showOpenFolder: (options?: { title?: string; defaultPath?: string }) => Promise<{ canceled: boolean; folderPath?: string }>;
  showDialogSave: (options?: { title?: string; defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<{ canceled: boolean; filePath?: string }>;
  openBackendFile: (params: { fileId: string; uri: string; mimeType: string; engineBinding?: { engineId: string; connectionId?: string }; initialText?: string }) => Promise<{ fileId: string; backendVersion: number }>;
  closeBackendFile: (params: { fileId: string }) => Promise<{ fileId: string; accepted: boolean }>;
  notifyBackendFileChange: (params: { fileId: string; version: number; text: string, uri: string, mimeType: string, engineBinding?: { engineId: string; connectionId?: string }  }) => Promise<void>;
  notifyBackendSettingsModuleChanged: (params: { moduleId: string; version: number }) => Promise<void>;
  watchFile: (params: { uri: string; options: { recursive?: boolean } }) => Promise<{ subscriptionId: string }>;
  unwatchFile: (params: { subscriptionId: string }) => Promise<{ removed: boolean }>;
  muteFileWatcherPath: (params: { uri: string; durationMs: number }) => Promise<{ muted: boolean }>;
  onFileWatcherEvent: (listener: (params: { subscriptionId: string; event: FileWatcherEvent }) => void) => () => void;
  onMenuExecuteCommand: (listener: (commandId: string) => void) => () => void;
  onQueryEvent: (listener: (event: { method: string; params: unknown }) => void) => () => void;
  onBackendStatusChanged: (listener: (status: BackendGatewayStatus) => void) => () => void;
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
  getAppDir: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  openExportStream: (params: { executionId: string; resultSetIndex: number }) => Promise<void>;
  appendExportChunk: (params: { executionId: string; resultSetIndex: number; rows: unknown[][] }) => Promise<void>;
  finalizeExportStream: (params: { executionId: string; resultSetIndex: number }) => Promise<{ exportPath: string }>;
  getRecentFiles: () => Promise<RecentFileEntry[]>;
  addRecentFile: (uri: string, maxCount?: number) => Promise<{ accepted: boolean }>;
  removeRecentFile: (uri: string) => Promise<{ removed: boolean }>;
  clearRecentFiles: () => Promise<{ cleared: boolean }>;
  evaluateExpression: (params: {
    expression: string;
    context: Record<string, unknown>;
    functions: Record<string, unknown>;
    timeoutMs: number;
    source?: string;
  }) => Promise<unknown>;
  evaluateExpressionSync: (params: {
    expression: string;
    context: Record<string, unknown>;
    functions: Record<string, unknown>;
    timeoutMs: number;
    source?: string;
  }) => { ok: true; result: unknown } | { ok: false; message: string };
}

declare global {
  interface Window {
    appShell: ShellApi;
  }
}
