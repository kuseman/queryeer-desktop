import { dialog, BrowserWindow, ipcMain } from "electron";

type DialogSeverity = "info" | "warning" | "error";

type DialogMessageOptions = {
  title: string;
  message: string;
  severity?: DialogSeverity;
  detail?: string;
  options?: { label: string; value: string }[];
};

type DialogOpenOptions = {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
  multiSelections?: boolean;
};

type DialogSaveOptions = {
  title?: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
};

export class DialogMainService {
  public wireIpc(): void {
    ipcMain.handle("dialog:show-message", async (_event, options: DialogMessageOptions) => {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) {
        return { action: "" };
      }

      const buttons = options.options?.map((opt) => opt.label) ?? ["OK"];
      const result = await dialog.showMessageBox(window, {
        type: this.toNativeMessageType(options.severity ?? "info"),
        title: options.title,
        message: options.message,
        detail: options.detail,
        buttons
      });

      const selectedOption = options.options?.[result.response];
      return { action: selectedOption?.value ?? "" };
    });

    ipcMain.handle("dialog:show-open", async (_event, options: DialogOpenOptions) => {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) {
        return { canceled: true, filePaths: [] };
      }

      const result = await dialog.showOpenDialog(window, {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        properties: options.multiSelections ? ["openFile", "multiSelections"] : ["openFile"]
      });

      return {
        canceled: result.canceled,
        filePaths: result.filePaths
      };
    });

    ipcMain.handle("dialog:show-save", async (_event, options: DialogSaveOptions) => {
      const window = BrowserWindow.getFocusedWindow();
      if (!window) {
        return { canceled: true, filePath: undefined };
      }

      const result = await dialog.showSaveDialog(window, {
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters
      });

      return {
        canceled: result.canceled,
        filePath: result.filePath
      };
    });
  }

  private toNativeMessageType(severity: DialogSeverity): "none" | "info" | "warning" | "error" {
    switch (severity) {
      case "info":
        return "info";
      case "warning":
        return "warning";
      case "error":
        return "error";
      default:
        return "none";
    }
  }
}
