import type { Plugin } from "../../contracts/plugin/Plugin";
import type { DialogResult } from "../../contracts/extensions/DialogExtension";
import { requestInputDialog } from "./input-dialog-service";
import { requestMessageDialog } from "./message-dialog-service";

const getAppShell = () => {
  return (window as unknown as {
    appShell?: {
      showDialogMessage: (options: {
        title: string;
        message: string;
        severity?: "info" | "warning" | "error";
        detail?: string;
        options?: { label: string; value: string }[];
      }) => Promise<DialogResult>;
      showDialogOpen: (options: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
        multiSelections?: boolean;
      }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      showOpenFolder: (options?: {
        title?: string;
        defaultPath?: string;
      }) => Promise<{ canceled: boolean; folderPath?: string }>;
      showDialogSave: (options: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<{ canceled: boolean; filePath?: string }>;
    };
  }).appShell;
};

export const coreDialogPlugin: Plugin = {
  manifest: {
    id: "core.dialog",
    name: "Core Dialog",
    version: "0.1.0",
    kind: "core",
    description: "Handles dialogs and file open/save operations"
  },
  activate: (context) => {
    const appShell = getAppShell();

    context.dialog.showMessage = async (options) => {
      return requestMessageDialog({
        title: options.title,
        message: options.message,
        severity: options.severity,
        detail: options.detail,
        options: options.options
      });
    };

    context.dialog.showOpenDialog = async (options) => {
      if (!appShell) {
        return { canceled: true, filePaths: [] };
      }
      return appShell.showDialogOpen({
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters,
        multiSelections: options.multiSelections
      });
    };

    context.dialog.showOpenFolder = async (options) => {
      if (!appShell) {
        return { canceled: true, folderPath: undefined };
      }
      return appShell.showOpenFolder({
        title: options?.title,
        defaultPath: options?.defaultPath
      });
    };

    context.dialog.showSaveDialog = async (options) => {
      if (!appShell) {
        return { canceled: true, filePath: undefined };
      }
      return appShell.showDialogSave({
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters
      });
    };

    context.dialog.showInputDialog = async (options) => {
      return requestInputDialog(options);
    };
  }
};
