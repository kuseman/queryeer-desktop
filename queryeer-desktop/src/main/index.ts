import { app, BrowserWindow, webContents } from "electron";
import { join } from "node:path";
import { ipcMain } from "electron";
import { BackendGateway } from "./backend/backend-gateway";
import { chokidarWatcherFactory } from "./file-watcher/chokidar-watcher-factory";
import { FileWatcherMainService } from "./file-watcher/file-watcher-service";
import { DialogMainService } from "./dialog/dialog-service";
import { discoverExternalFrontendPlugins } from "./plugins/frontend-plugin-discovery";
import { BackupStore, defaultBackupsDir } from "./workspace/backup-store";
import {
  defaultWorkspaceFilePath,
  WorkspaceStore
} from "./workspace/workspace-store";

const isDev = !app.isPackaged;
const backendGateway = new BackendGateway();
const dialogService = new DialogMainService();
const fileWatcherService = new FileWatcherMainService({
  watcherFactory: chokidarWatcherFactory,
  webContentsLookup: (id) => {
    const sink = webContents.fromId(id);
    return sink ?? null;
  }
});
let workspaceStore: WorkspaceStore | null = null;
let backupStore: BackupStore | null = null;

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

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

app.whenReady().then(() => {
  backendGateway.wireIpc();
  dialogService.wireIpc();
  fileWatcherService.wireIpc();
  workspaceStore = new WorkspaceStore({
    workspaceFilePath: defaultWorkspaceFilePath(app.getPath("userData"))
  });
  workspaceStore.wireIpc();
  backupStore = new BackupStore({
    backupsDir: defaultBackupsDir(app.getPath("userData"))
  });
  backupStore.wireIpc();
  ipcMain.handle("plugins:get-frontend-targets", async () => discoverExternalFrontendPlugins());
  void backendGateway.start();

  createMainWindow();

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
