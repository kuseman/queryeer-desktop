import type { RecentFileEntry } from "../../contracts/shell/Api";

type RecentFilesBridge = {
  getRecentFiles: () => Promise<RecentFileEntry[]>;
  addRecentFile: (uri: string) => Promise<{ accepted: boolean }>;
  removeRecentFile: (uri: string) => Promise<{ removed: boolean }>;
  clearRecentFiles: () => Promise<{ cleared: boolean }>;
};

export type RecentFilesServiceOptions = {
  bridge: RecentFilesBridge;
  getStat: (uri: string) => Promise<{ success: boolean; stat: { isFile: boolean } | null }>;
  showDialog: (options: {
    title: string;
    message: string;
    severity?: "warning";
    detail?: string;
    options?: { label: string; value: string }[];
  }) => Promise<{ action: string }>;
};

let serviceInstance: RecentFilesService | null = null;

export class RecentFilesService {
  private readonly bridge: RecentFilesBridge;
  private readonly getStat: RecentFilesServiceOptions["getStat"];
  private readonly showDialog: RecentFilesServiceOptions["showDialog"];

  public constructor(options: RecentFilesServiceOptions) {
    this.bridge = options.bridge;
    this.getStat = options.getStat;
    this.showDialog = options.showDialog;
  }

  public async getRecentFiles(): Promise<RecentFileEntry[]> {
    return this.bridge.getRecentFiles();
  }

  public async addRecentFile(uri: string): Promise<void> {
    await this.bridge.addRecentFile(uri);
  }

  public async openRecentFile(
    openFile: (uri: string) => Promise<void>
  ): Promise<{ opened: boolean }> {
    const entries = await this.bridge.getRecentFiles();
    if (entries.length === 0) {
      return { opened: false };
    }

    const entry = entries[0]!;
    const stat = await this.getStat(entry.uri);
    if (!stat.success || !stat.stat?.isFile) {
      const result = await this.showDialog({
        title: "File Not Found",
        message: `The file "${this.getFileName(entry.uri)}" could not be found.`,
        severity: "warning",
        detail: "It may have been moved or deleted. Remove it from recent files?",
        options: [
          { label: "Remove", value: "remove" },
          { label: "Cancel", value: "cancel" }
        ]
      });

      if (result.action === "remove") {
        await this.bridge.removeRecentFile(entry.uri);
        return { opened: false };
      }
      return { opened: false };
    }

    await openFile(entry.uri);
    return { opened: true };
  }

  public async removeRecentFile(uri: string): Promise<void> {
    await this.bridge.removeRecentFile(uri);
  }

  public async clearRecentFiles(): Promise<void> {
    await this.bridge.clearRecentFiles();
  }

  private getFileName(uri: string): string {
    if (uri.startsWith("file://")) {
      return uri.split("/").pop() ?? uri;
    }
    return uri;
  }
}

export function initializeRecentFilesService(options: RecentFilesServiceOptions): RecentFilesService {
  if (!serviceInstance) {
    serviceInstance = new RecentFilesService(options);
  }
  return serviceInstance;
}

export function getRecentFilesService(): RecentFilesService | null {
  return serviceInstance;
}