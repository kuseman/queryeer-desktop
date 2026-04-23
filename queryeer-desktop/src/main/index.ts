import { app, BrowserWindow, webContents, nativeImage } from "electron";
import { join } from "node:path";
import { ipcMain } from "electron";
import { BackendGateway } from "./backend/backend-gateway";
import { chokidarWatcherFactory } from "./file-watcher/chokidar-watcher-factory";
import { FileWatcherMainService } from "./file-watcher/file-watcher-service";
import { DialogMainService } from "./dialog/dialog-service";
import { MenuService } from "./menu/menu-service";
import { discoverExternalFrontendPlugins } from "./plugins/frontend-plugin-discovery";
import {
  defaultKeybindingsFilePath,
  KeybindingsStore
} from "./commands/keybindings-store";
import { BackupStore, defaultBackupsDir } from "./workspace/backup-store";
import {
  defaultWorkspaceFilePath,
  WorkspaceStore
} from "./workspace/workspace-store";

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
      sandbox: true
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
  void backendGateway.start();

  if (process.platform === "darwin" && app.dock && !dockIcon.isEmpty()) {
    app.dock.setIcon(dockIcon);
  } else if (process.platform === "win32") {
    app.setAppUserModelId("com.queryeer.electron");
  }

  createMainWindow();
  sendWindowState();

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
