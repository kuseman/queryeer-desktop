import { ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RecentFileEntry = {
  uri: string;
  lastOpenedAt: string;
};

export type RecentFilesDocument = {
  version: number;
  updatedAt: string;
  files: RecentFileEntry[];
};

export type RecentFilesStoreOptions = {
  recentFilesPath: string;
  maxCount?: number;
  logError?: (message: string, error: Error) => void;
  now?: () => string;
};

const RECENT_FILES_VERSION = 1;
const DEFAULT_MAX_COUNT = 100;

export class RecentFilesStore {
  private readonly recentFilesPath: string;
  private readonly logError: (message: string, error: Error) => void;
  private readonly now: () => string;

  public constructor(options: RecentFilesStoreOptions) {
    this.recentFilesPath = options.recentFilesPath;
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public wireIpc(): void {
    ipcMain.handle("recent:get", async () => this.list());
    ipcMain.handle("recent:add", async (_event, params: { uri: string; maxCount?: number }) => {
      await this.add(params.uri, params.maxCount);
      return { accepted: true };
    });
    ipcMain.handle("recent:remove", async (_event, params: { uri: string }) => {
      await this.remove(params.uri);
      return { removed: true };
    });
    ipcMain.handle("recent:clear", async () => {
      await this.clear();
      return { cleared: true };
    });
  }

  public async list(): Promise<RecentFileEntry[]> {
    try {
      const raw = await readFile(this.recentFilesPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RecentFilesDocument>;
      if (parsed.version !== RECENT_FILES_VERSION) {
        return [];
      }
      return Array.isArray(parsed.files) ? parsed.files : [];
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      this.logError(
        `Failed to read recent files at ${this.recentFilesPath}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return [];
    }
  }

  public async add(uri: string, maxCount?: number): Promise<void> {
    const existing = await this.list();
    const filtered = existing.filter((e) => e.uri !== uri);
    const limit = maxCount ?? DEFAULT_MAX_COUNT;
    const updated: RecentFileEntry[] = [
      { uri, lastOpenedAt: this.now() },
      ...filtered
    ].slice(0, limit);
    await this.write(updated);
  }

  public async remove(uri: string): Promise<void> {
    const existing = await this.list();
    const updated = existing.filter((e) => e.uri !== uri);
    await this.write(updated);
  }

  public async clear(): Promise<void> {
    await this.write([]);
  }

  private async write(files: RecentFileEntry[]): Promise<void> {
    await mkdir(dirname(this.recentFilesPath), { recursive: true });
    const tempPath = `${this.recentFilesPath}.tmp`;
    const payload: RecentFilesDocument = {
      version: RECENT_FILES_VERSION,
      updatedAt: this.now(),
      files
    };
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, this.recentFilesPath);
  }
}

export function defaultRecentFilesPath(userDataDir: string): string {
  return join(userDataDir, "recent-files.json");
}