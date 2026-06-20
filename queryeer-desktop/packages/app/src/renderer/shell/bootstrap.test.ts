import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../plugins/discovery", () => ({
  discoverPluginModules: vi.fn()
}));

import { bootstrapShell } from "./bootstrap";
import { discoverPluginModules } from "../../plugins/discovery";

type MockedDiscovery = typeof discoverPluginModules & {
  mockResolvedValue: (value: unknown) => void;
};

describe("bootstrapShell diagnostics wiring", () => {
  const originalAppShell = window.appShell;

  afterEach(() => {
    window.appShell = originalAppShell;
    vi.clearAllMocks();
  });

  it("surfaces external module load errors in plugin diagnostics", async () => {
    window.appShell = {
      platform: "win32",
      version: "0.1.0",
      readFile: async () => ({ success: true, content: "" }),
      writeFile: async () => ({ success: true }),
      getBackendStatus: async () => ({
        mode: "mock-stdio",
        state: "healthy",
        supportedCapabilities: [],
        activeExecutionIds: [],
        recentExecutions: [],
        backendLogs: []
      }),
      toggleBackendTrace: async () => {},
      setLogFlow: async () => {},
      clearBackendLogs: async () => {},
      getMemoryUsage: async () => ({ heapUsed: 0, heapTotal: 0, rss: 0 }),
      getExternalFrontendPlugins: async () => [
        {
          id: "external.bad.module",
          name: "Bad Module",
          version: "1.0.0",
          modulePath: "C:/plugins/bad-module.mjs",
          sourcePath: "C:/plugins/bad-module.zip"
        }
      ],
      executeBackendQuery: async () => ({ accepted: true, queryExecutionId: "q-1" }),
      cancelBackendQuery: async () => ({ accepted: true, queryExecutionId: "q-1" }),
      invokeBackendEngine: async () => ({ result: {} }),
      getWorkspace: async () => ({
        schemaVersion: 2 as const,
        savedAt: "1970-01-01T00:00:00.000Z",
        files: []
      }),
      saveWorkspace: async () => ({ accepted: true }),
      getUserKeybindings: async () => ({ version: 1 as const, bindings: [], unbound: [] }),
      saveUserKeybindings: async () => ({ accepted: true }),
      getSettingsIndex: async () => ({ version: 1 as const, updatedAt: new Date(0).toISOString(), modules: {} }),
      getSettingsModule: async ({ moduleId }: { moduleId: string }) => ({
        version: 1 as const,
        moduleId,
        updatedAt: new Date(0).toISOString(),
        values: {}
      }),
      saveSettingsIndex: async () => ({ accepted: true }),
      saveSettingsModule: async () => ({ accepted: true }),
      getSecurityStatus: async () => ({
        unlocked: false,
        hasPersistedVault: false,
        hasStoredMasterPassword: false
      }),
      unlockSecurity: async () => ({ accepted: true }),
      unlockSecurityWithStored: async () => ({ accepted: false }),
      lockSecurity: async () => ({ accepted: true }),
      storeSecret: async () => ({ secretRef: "secret-ref-1" }),
      resolveSecret: async () => ({ found: false }),
      deleteSecret: async () => ({ deleted: false }),
      rotateSecurityMasterPassword: async () => ({ accepted: true }),
      listAssistantModels: async () => ({ models: [] }),
      completeAssistantChat: async () => ({ message: { role: "assistant", content: "" } }),
      saveWorkspaceBackup: async () => ({ backupUri: "file:///backup" }),
      purgeWorkspaceBackups: async () => ({ purged: 0 }),
      listWorkspaceBackups: async () => ({ backupPaths: [] }),
      readLatestWorkspaceBackup: async () => null,
      showDialogMessage: async () => ({ action: "" }),
      showDialogOpen: async () => ({ canceled: true, filePaths: [] }),
      showDialogSave: async () => ({ canceled: true, filePath: undefined }),
      readDir: async () => ({ success: true, items: [] }),
      getStat: async () => ({ success: true, stat: { isDirectory: false, isFile: true, size: 0, modified: "" } }),
      showOpenFolder: async () => ({ canceled: true, folderPath: undefined }),
      openBackendFile: async () => ({ fileId: "f-1", backendVersion: 0 }),
      closeBackendFile: async () => ({ fileId: "f-1", accepted: true }),
      notifyBackendFileChange: async () => {},
      notifyBackendSettingsModuleChanged: async () => {},
      watchFile: async () => ({ subscriptionId: "fw-test-1" }),
      unwatchFile: async () => ({ removed: true }),
      muteFileWatcherPath: async () => ({ muted: true }),
      onFileWatcherEvent: () => () => {},
      onMenuExecuteCommand: () => () => {},
      onQueryEvent: () => () => {},
      onBackendStatusChanged: () => () => {},
      buildMenu: async () => ({ success: true }),
      rebuildMenu: async () => ({ success: true }),
      windowMinimize: () => {},
      windowMaximize: () => {},
      windowClose: () => {},
      isWindowMaximized: async () => false,
      isDev: async () => false,
      onWindowStateChanged: () => () => {},
      zoomIn: async () => {},
      zoomOut: async () => {},
      zoomReset: async () => {},
      undo: async () => {},
      redo: async () => {},
      cut: async () => {},
      copy: async () => {},
      paste: async () => {},
      selectAll: async () => {},
      reloadWindow: async () => {},
      forceReloadWindow: async () => {},
      toggleFullScreen: async () => {},
      toggleDevTools: async () => {},
      showItemInFolder: async () => ({ success: true }),
      openPath: async () => ({ success: true }),
      getAppDir: async () => "",
      openExternal: async () => {},
      openExportStream: async (_params: { executionId: string; resultSetIndex: number }) => {},
      appendExportChunk: async (_params: { executionId: string; resultSetIndex: number; rows: unknown[][] }) => {},
      finalizeExportStream: async (_params: { executionId: string; resultSetIndex: number }) => ({ exportPath: "" }),
      getRecentFiles: async () => [],
      addRecentFile: async () => ({ accepted: true }),
      removeRecentFile: async () => ({ removed: true }),
      clearRecentFiles: async () => ({ cleared: true }),
      evaluateExpression: async () => true,
      evaluateExpressionSync: () => ({ ok: true, result: true }),
      getAboutMetadata: async () => ({ appVersion: "0.1.0", electronVersion: "41.0.0", chromiumVersion: "126.0.0", nodeVersion: "20.0.0", platform: "win32", arch: "x64" }),
      getDesktopChangelog: async () => null,
      fetchQueryeerReleases: async () => ({ ok: true, releases: [] }),
      fetchBackendPluginChangelogs: async () => ({ plugins: [] }),
      getPluginInventory: async () => ({ pluginsDir: "", lockfilePath: "", safeMode: false, plugins: [] }),
      setPluginEnabled: async () => ({ accepted: true, restartRequired: true }),
      installPluginFromZip: async () => ({ accepted: true, restartRequired: true }),
      uninstallPlugin: async () => ({ accepted: true, restartRequired: true })
    };

    (discoverPluginModules as MockedDiscovery).mockResolvedValue({
      manifests: [
        {
          id: "core.layout",
          name: "Core Layout",
          version: "0.1.0",
          kind: "core",
          modulePath: "./core.layout/module"
        }
      ],
      modules: [
        {
          manifest: {
            id: "core.layout",
            name: "Core Layout",
            version: "0.1.0",
            kind: "core",
            modulePath: "./core.layout/module"
          },
          plugin: {
            manifest: {
              id: "core.layout",
              name: "Core Layout",
              version: "0.1.0",
              kind: "core"
            },
            activate: async (context: {
              layout: {
                registerView: (view: {
                  id: string;
                  title: string;
                  defaultZone: "primarySidebar" | "secondarySidebar";
                  render: () => string;
                }) => void;
              };
            }) => {
              context.layout.registerView({
                id: "test.view",
                title: "Test View",
                defaultZone: "primarySidebar",
                render: () => "test"
              });
            }
          }
        }
      ],
      loadErrors: [
        {
          pluginId: "external.bad.module",
          modulePath: "C:/plugins/bad-module.mjs",
          message: "External plugin module 'C:/plugins/bad-module.mjs' does not export pluginModule"
        }
      ]
    });

    const result = await bootstrapShell();

    expect(result.contextChain.getEffectiveContext()).toMatchObject({ activeFileId: null });

    const activeFile = await result.fileMediator.createUntitledFile({ mimeType: "text/plain" });

    expect(result.contextChain.getEffectiveContext()).toMatchObject({
      activeFileId: activeFile.fileId,
      hasActiveFile: true,
      activeFile: expect.objectContaining({ fileId: activeFile.fileId })
    });

    expect(result.diagnostics.externalLoadErrors).toEqual([
      {
        pluginId: "external.bad.module",
        modulePath: "C:/plugins/bad-module.mjs",
        message: "External plugin module 'C:/plugins/bad-module.mjs' does not export pluginModule"
      }
    ]);
  });
});
