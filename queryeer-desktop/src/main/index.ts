import { app, BrowserWindow, webContents, nativeImage } from "electron";
import { join } from "node:path";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { ipcMain } from "electron";
import { fileUriToPath } from "../contracts/files/Resolvers.js";
import { BackendGateway } from "./backend/backend-gateway.js";
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
import {
  defaultWorkspaceFilePath,
  WorkspaceStore
} from "./workspace/workspace-store.js";

const isDev = !app.isPackaged;
const backendGateway = new BackendGateway();
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
let backupStore: BackupStore | null = null;
let mainWindow: BrowserWindow | null = null;

const dockIconPath = join(__dirname, "../../resources/icons/icon-128.png");
const windowIconPath = join(__dirname, "../../resources/icons/icon-256.png");
const dockIcon = nativeImage.createFromPath(dockIconPath);
const windowIcon = nativeImage.createFromPath(windowIconPath);

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    frame: false,
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

app.whenReady().then(() => {
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
  backupStore = new BackupStore({
    backupsDir: defaultBackupsDir(app.getPath("userData"))
  });
  backupStore.wireIpc();
  ipcMain.handle("plugins:get-frontend-targets", async () => discoverExternalFrontendPlugins());
  ipcMain.handle("file:read", async (_event, { uri }: { uri: string }) => {
    try {
      const filePath = fileUriToPath(uri);
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
    app.setAppUserModelId("com.queryeer.electron");
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
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    void backendGateway.stop();
    void workspaceStore?.flush();
    app.quit();
  }
});
