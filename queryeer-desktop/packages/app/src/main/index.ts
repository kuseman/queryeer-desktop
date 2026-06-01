import { app, BrowserWindow, webContents, nativeImage, shell } from "electron";
import { join } from "node:path";
import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { memoryUsage, versions } from "node:process";
import { ipcMain } from "electron";
import { installExtension, REACT_DEVELOPER_TOOLS } from "electron-devtools-installer";
import { fileUriToPath } from "@queryeer/api/files/Resolvers.js";
import { BackendGateway } from "./backend/backend-gateway.js";
import { DevBackendTransport } from "./backend/backend-transport-dev.js";
import { ProdBackendTransport } from "./backend/backend-transport-prod.js";
import type { BackendTransportFactory } from "./backend/backend-transport.js";
import { chokidarWatcherFactory } from "./file-watcher/chokidar-watcher-factory.js";
import { FileWatcherMainService } from "./file-watcher/file-watcher-service.js";
import { DialogMainService } from "./dialog/dialog-service.js";
import { MenuService } from "./menu/menu-service.js";
import { discoverExternalFrontendPlugins } from "./plugins/frontend-plugin-discovery.js";
import {
  defaultKeybindingsFilePath,
  KeybindingsStore
} from "./commands/keybindings-store.js";
import { BackupStore, defaultBackupsDir } from "./workspace/backup-store.js";
import { defaultExportsDir, QueryExportStore } from "./workspace/query-export-store.js";
import {
  defaultWorkspaceFilePath,
  WorkspaceStore
} from "./workspace/workspace-store.js";
import { defaultSettingsDirPath, SettingsStore } from "./settings/settings-store.js";
import { defaultRecentFilesPath, RecentFilesStore } from "./recent-files/recent-files-store.js";
import { SecurityService } from "./security/security-service.js";
import { defaultSecurityDirPath, VaultStore } from "./security/vault-store.js";
import { AssistantHttpService } from "./assistant/assistant-http-service.js";
import { createBeforeQuitHandler } from "./app-shutdown.js";
import { wireExpressionEvaluatorIpc } from "./expressions/expression-evaluator.js";
import { defaultPluginsDirPath } from "./plugins/plugin-paths.js";
import { defaultPluginsLockfilePath, PluginInventoryService } from "./plugins/plugin-inventory-service.js";

const isDev = !app.isPackaged;
const queryeerReleasesUrl = "https://api.github.com/repos/kuseman/queryeer-desktop/releases";

// Keep userData path stable when package name changes (e.g. @queryeer/app)
app.setName("queryeer-desktop");

function isPluginSafeMode(): boolean {
  return process.argv.includes("--safe-mode");
}

function createBackendFactory(): BackendTransportFactory {
  const appDir = app.getPath("userData");
  const settingsDirPath = defaultSettingsDirPath(appDir);
  const pluginsDirPath = defaultPluginsDirPath(appDir);
  const pluginsSafeMode = isPluginSafeMode();
  if (app.isPackaged) {
    return {
      mode: "prod-jar",
      create: (callbacks) =>
        new ProdBackendTransport(callbacks, {
          appDir,
          settingsDirPath,
          pluginsDirPath,
          pluginsSafeMode,
          getDisabledPluginIds: () => pluginInventoryService?.getDisabledPluginIds() ?? []
        })
    };
  }
  const devState = { dependenciesPrepared: false };
  return {
    mode: "dev-maven",
    create: (callbacks) =>
      new DevBackendTransport(callbacks, devState, {
        appDir,
        settingsDirPath,
        pluginsDirPath,
        pluginsSafeMode,
        getDisabledPluginIds: () => pluginInventoryService?.getDisabledPluginIds() ?? []
      })
  };
}

const backendGateway = new BackendGateway(createBackendFactory());
const dialogService = new DialogMainService();
const menuService = new MenuService();
const fileWatcherService = new FileWatcherMainService({
  watcherFactory: chokidarWatcherFactory,
  webContentsLookup: (id) => {
    const sink = webContents.fromId(id);
    return sink ?? null;
  }
});
let workspaceStore: WorkspaceStore | null = null;
let keybindingsStore: KeybindingsStore | null = null;
let settingsStore: SettingsStore | null = null;
let backupStore: BackupStore | null = null;
let queryExportStore: QueryExportStore | null = null;
let recentFilesStore: RecentFilesStore | null = null;
let securityService: SecurityService | null = null;
let pluginInventoryService: PluginInventoryService | null = null;
let mainWindow: BrowserWindow | null = null;

const beforeQuitHandler = createBeforeQuitHandler({
  stopBackend: () => backendGateway.stop(),
  flushWorkspace: () => workspaceStore?.flush() ?? Promise.resolve(),
  requestQuit: () => app.quit()
});

const dockIconPath = join(__dirname, "../../resources/icons/icon-128.png");
const windowIconPath = join(__dirname, "../../resources/icons/icon-256.png");
const dockIcon = nativeImage.createFromPath(dockIconPath);
const windowIcon = nativeImage.createFromPath(windowIconPath);

function createMainWindow(): void {
  const isDarwin = process.platform === "darwin";

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: isDarwin,
    ...(isDarwin ? { titleBarStyle: "hiddenInset" as const } : {}),
    icon: windowIcon.isEmpty() ? undefined : windowIcon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow = window;

  if (!windowIcon.isEmpty()) {
    window.setIcon(windowIcon);
  }

  window.once("ready-to-show", () => {
    window.show();
  });

  if (isDev) {
    window.loadURL("http://localhost:5173");
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  window.loadFile(join(__dirname, "../renderer/index.html"));
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const appDataDir = app.getPath("userData");
  const settingsDirPath = defaultSettingsDirPath(appDataDir);
  const pluginsDirPath = defaultPluginsDirPath(appDataDir);
  await Promise.all([
    mkdir(settingsDirPath, { recursive: true }),
    mkdir(join(appDataDir, "libShared"), { recursive: true }),
    mkdir(join(appDataDir, "libNative"), { recursive: true }),
    mkdir(pluginsDirPath, { recursive: true })
  ].map((operation) => operation.catch(() => undefined)));

  backendGateway.wireIpc();
  dialogService.wireIpc();
  menuService.wireIpc();
  menuService.setExecuteCommand(async (commandId: string) => {
    if (mainWindow) {
      mainWindow.webContents.send("menu:execute-command", commandId);
    }
  });
  fileWatcherService.wireIpc();
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.on("window:close", () => mainWindow?.close());
  ipcMain.handle("window:is-maximized", () => mainWindow?.isMaximized() ?? false);
  ipcMain.handle("app:is-dev", () => isDev);
  ipcMain.handle("window:zoom-in", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      const wc = window.webContents;
      wc.setZoomLevel(wc.getZoomLevel() + 1);
    }
  });
  ipcMain.handle("window:zoom-out", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      const wc = window.webContents;
      wc.setZoomLevel(wc.getZoomLevel() - 1);
    }
  });
  ipcMain.handle("window:zoom-reset", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.setZoomLevel(0);
    }
  });
  ipcMain.handle("window:undo", () => {
    const window = BrowserWindow.getFocusedWindow();
    window?.webContents.undo();
  });
  ipcMain.handle("window:redo", () => {
    const window = BrowserWindow.getFocusedWindow();
    window?.webContents.redo();
  });
  ipcMain.handle("window:cut", () => {
    const window = BrowserWindow.getFocusedWindow();
    window?.webContents.cut();
  });
  ipcMain.handle("window:copy", () => {
    const window = BrowserWindow.getFocusedWindow();
    window?.webContents.copy();
  });
  ipcMain.handle("window:paste", () => {
    const window = BrowserWindow.getFocusedWindow();
    window?.webContents.paste();
  });
  ipcMain.handle("window:select-all", () => {
    const window = BrowserWindow.getFocusedWindow();
    window?.webContents.selectAll();
  });
  ipcMain.handle("window:reload", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.reload();
    }
  });
  ipcMain.handle("window:force-reload", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.webContents.reloadIgnoringCache();
    }
  });
  ipcMain.handle("window:toggle-full-screen", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      window.setFullScreen(!window.isFullScreen());
    }
  });
  ipcMain.handle("window:toggle-dev-tools", () => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      if (window.webContents.isDevToolsOpened()) {
        window.webContents.closeDevTools();
      } else {
        window.webContents.openDevTools({ mode: "detach" });
      }
    }
  });
  ipcMain.handle("shell:show-item-in-folder", async (_event, { uri }: { uri: string }) => {
    try {
      const filePath = fileUriToPath(uri);
      shell.showItemInFolder(filePath);
      return { success: true };
    } catch {
      return { success: false };
    }
  });
  ipcMain.handle("shell:open-path", async (_event, { uri }: { uri: string }) => {
    try {
      const filePath = fileUriToPath(uri);
      const result = await shell.openPath(filePath);
      if (result) {
        return { success: false, error: result };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });
  ipcMain.handle("app:get-dir", () => app.getPath("userData"));
  ipcMain.handle("app:get-memory-usage", () => {
    const usage = memoryUsage();
    return { heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss };
  });
  ipcMain.handle("app:get-about-metadata", () => {
    return {
      appVersion: app.getVersion(),
      electronVersion: versions.electron,
      chromiumVersion: versions.chrome,
      nodeVersion: versions.node,
      platform: process.platform,
      arch: process.arch
    };
  });
  ipcMain.handle("app:get-desktop-changelog", async () => {
    try {
      const changelogPath = join(app.getAppPath(), "CHANGELOG.md");
      return await readFile(changelogPath, "utf8");
    } catch {
      return null;
    }
  });
  ipcMain.handle("app:fetch-queryeer-releases", async () => {
    try {
      const response = await fetch(queryeerReleasesUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `Queryeer/${app.getVersion()}`
        }
      });
      if (!response.ok) {
        return { ok: false, releases: [] };
      }
      return { ok: true, releases: await response.json() };
    } catch {
      return { ok: false, releases: [] };
    }
  });
  ipcMain.handle("shell:open-external", async (_event, { url }: { url: string }) => {
    await shell.openExternal(url);
  });
  wireExpressionEvaluatorIpc(ipcMain);

  const sendWindowState = () => {
    if (!mainWindow) {
      return;
    }
    mainWindow.webContents.send("window:state-changed", {
      maximized: mainWindow.isMaximized()
    });
  };

  app.on("browser-window-created", (_event, window) => {
    if (window !== mainWindow) {
      return;
    }
    window.on("maximize", sendWindowState);
    window.on("unmaximize", sendWindowState);
  });
  workspaceStore = new WorkspaceStore({
    workspaceFilePath: defaultWorkspaceFilePath(app.getPath("userData"))
  });
  workspaceStore.wireIpc();
  keybindingsStore = new KeybindingsStore({
    keybindingsFilePath: defaultKeybindingsFilePath(app.getPath("userData"))
  });
  keybindingsStore.wireIpc();
  settingsStore = new SettingsStore({
    settingsDirPath
  });
  settingsStore.wireIpc();
  backupStore = new BackupStore({
    backupsDir: defaultBackupsDir(app.getPath("userData"))
  });
  backupStore.wireIpc();
  queryExportStore = new QueryExportStore(defaultExportsDir(app.getPath("userData")));
  queryExportStore.wireIpc();
  recentFilesStore = new RecentFilesStore({
    recentFilesPath: defaultRecentFilesPath(app.getPath("userData"))
  });
  recentFilesStore.wireIpc();
  securityService = new SecurityService(
    new VaultStore({
      securityDirPath: defaultSecurityDirPath(app.getPath("userData"))
    }),
    {
      onSessionOpen: async (params) => {
        await backendGateway.notifySecuritySessionOpen(params);
      },
      onSessionClose: async (params) => {
        await backendGateway.notifySecuritySessionClose(params);
      },
      onVaultChanged: async (params) => {
        await backendGateway.notifySecurityVaultChanged(params);
      }
    }
  );
  backendGateway.setOnTransportDiedHook(() => {
    void securityService?.invalidateBackendSession();
  });
  securityService.wireIpc();
  const assistantHttpService = new AssistantHttpService({
    resolveSecret: (secretRef) => securityService!.resolveSecret(secretRef)
  });
  assistantHttpService.wireIpc();
  pluginInventoryService = new PluginInventoryService({
    pluginsDir: pluginsDirPath,
    lockfilePath: defaultPluginsLockfilePath(settingsDirPath),
    isSafeMode: isPluginSafeMode
  });
  await pluginInventoryService.initialize();
  ipcMain.handle("plugins:get-inventory", async () => pluginInventoryService!.getInventory());
  ipcMain.handle("plugins:set-enabled", async (_event, params: { pluginId: string; enabled: boolean }) => {
    return pluginInventoryService!.setEnabled(params.pluginId, params.enabled);
  });
  ipcMain.handle("plugins:install-from-zip", async (_event, params: { zipFilePath: string }) => {
    return pluginInventoryService!.installFromZip(params.zipFilePath);
  });
  ipcMain.handle("plugins:uninstall", async (_event, params: { pluginId: string }) => {
    return pluginInventoryService!.uninstall(params.pluginId);
  });
  ipcMain.handle("plugins:get-frontend-targets", async () => {
    if (isPluginSafeMode()) {
      return [];
    }
    const inventory = await pluginInventoryService!.getInventory();
    const enabledPluginIds = new Set(inventory.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.id));
    return (await discoverExternalFrontendPlugins(pluginsDirPath)).filter((plugin) => enabledPluginIds.has(plugin.id));
  });
  ipcMain.handle("file:read", async (_event, { uri }: { uri: string }) => {
    try {
      const filePath = fileUriToPath(uri);
      const MAX_FILE_SIZE_BYTES = 512 * 1024 * 1024;
      const stats = await stat(filePath);
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        return { success: false, content: "", tooLarge: true, fileSizeBytes: stats.size };
      }
      const content = await readFile(filePath, "utf8");
      return { success: true, content };
    } catch {
      return { success: false, content: "" };
    }
  });
  ipcMain.handle("file:write", async (_event, { uri, content }: { uri: string; content: string }) => {
    try {
      const filePath = fileUriToPath(uri);
      await writeFile(filePath, content, "utf8");
      return { success: true };
    } catch {
      return { success: false };
    }
  });
  ipcMain.handle("fs:read-dir", async (_event, { uri }: { uri: string }) => {
    try {
      const dirPath = fileUriToPath(uri);
      const entries = await readdir(dirPath, { withFileTypes: true });
      const items = await Promise.all(
        entries.map(async (entry) => {
          const fullPath = join(dirPath, entry.name);
          try {
            const stats = await stat(fullPath);
            return {
              name: entry.name,
              isDirectory: entry.isDirectory(),
              isFile: entry.isFile(),
              size: stats.size,
              modified: stats.mtime.toISOString()
            };
          } catch {
            return null;
          }
        })
      );
      return { success: true, items: items.filter(Boolean) };
    } catch {
      return { success: false, items: [] };
    }
  });
  ipcMain.handle("fs:get-stat", async (_event, { uri }: { uri: string }) => {
    try {
      const filePath = fileUriToPath(uri);
      const stats = await stat(filePath);
      return {
        success: true,
        stat: {
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size,
          modified: stats.mtime.toISOString()
        }
      };
    } catch {
      return { success: false, stat: null };
    }
  });
  void backendGateway.start();

  if (process.platform === "darwin" && app.dock && !dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  } else if (process.platform === "win32") {
    app.setAppUserModelId("com.queryeer.desktop");
  }

  if (isDev) {
    void installExtension(REACT_DEVELOPER_TOOLS)
      .then((extension) => console.log(`Added Extension: ${extension.name}`))
      .catch((error: unknown) => console.log("An error occurred:", error));
  }

  createMainWindow();
  sendWindowState();

  if (mainWindow) {
    const win = mainWindow;
    backendGateway.setRendererSink((method, params) => {
      if (!win.isDestroyed()) {
        win.webContents.send("query:event", { method, params });
      }
    });
    backendGateway.setStatusChangedSink((status) => {
      if (!win.isDestroyed()) {
        win.webContents.send("backend:status-changed", status);
      }
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  beforeQuitHandler(event);
});
