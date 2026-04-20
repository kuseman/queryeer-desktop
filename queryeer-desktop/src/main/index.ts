import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { ipcMain } from "electron";
import { BackendGateway } from "./backend/backend-gateway";
import { discoverExternalFrontendPlugins } from "./plugins/frontend-plugin-discovery";

const isDev = !app.isPackaged;
const backendGateway = new BackendGateway();

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
    app.quit();
  }
});
