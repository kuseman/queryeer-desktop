export type DialogSeverity = "info" | "warning" | "error";

export type DialogOption = {
  label: string;
  value: string;
};

export type DialogResult = {
  action: string;
};

export type DialogExtension = {
  showMessage: (options: {
    title: string;
    message: string;
    severity?: DialogSeverity;
    detail?: string;
    options?: DialogOption[];
  }) => Promise<DialogResult>;
  showOpenDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
    multiSelections?: boolean;
  }) => Promise<{ canceled: boolean; filePaths: string[] }>;
  showOpenFolder: (options?: {
    title?: string;
    defaultPath?: string;
  }) => Promise<{ canceled: boolean; folderPath?: string }>;
  showSaveDialog: (options: {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<{ canceled: boolean; filePath?: string }>;
  showInputDialog?: (options: {
    title: string;
    message: string;
    placeholder?: string;
    password?: boolean;
  }) => Promise<{ canceled: boolean; value?: string }>;
  showValuePreview?: (options: {
    title: string;
    value: string;
    mimeType?: string;
  }) => Promise<void>;
  closeActiveValuePreview?: () => boolean;
};
