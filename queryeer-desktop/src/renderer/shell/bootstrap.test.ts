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
      bindBackendFile: async () => ({ fileId: "f-1", engineId: "payloadbuilder", backendVersion: 1 }),
      notifyBackendFileChange: async () => {},
      watchFile: async () => ({ subscriptionId: "fw-test-1" }),
      unwatchFile: async () => ({ removed: true }),
      muteFileWatcherPath: async () => ({ muted: true }),
      onFileWatcherEvent: () => () => {},
      onMenuExecuteCommand: () => () => {},
      onQueryEvent: () => () => {},
      buildMenu: async () => ({ success: true }),
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
      toggleDevTools: async () => {}
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

    expect(result.diagnostics.externalLoadErrors).toEqual([
      {
        pluginId: "external.bad.module",
        modulePath: "C:/plugins/bad-module.mjs",
        message: "External plugin module 'C:/plugins/bad-module.mjs' does not export pluginModule"
      }
    ]);
  });
});
