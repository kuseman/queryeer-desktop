import { ipcMain } from "electron";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export type BackupStoreOptions = {
  backupsDir: string;
  retention?: number;
  now?: () => number;
  logError?: (message: string, error: Error) => void;
};

const DEFAULT_RETENTION = 5;
const BACKUP_SUFFIX = ".bak";

function escapeForRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class BackupStore {
  private readonly backupsDir: string;
  private readonly retention: number;
  private readonly now: () => number;
  private readonly logError: (message: string, error: Error) => void;

  public constructor(options: BackupStoreOptions) {
    this.backupsDir = options.backupsDir;
    this.retention = options.retention ?? DEFAULT_RETENTION;
    this.now = options.now ?? (() => Date.now());
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
  }

  public wireIpc(): void {
    ipcMain.handle(
      "workspace:save-backup",
      async (_event, params: { fileId: string; text: string }) => {
        return this.saveBackup(params.fileId, params.text);
      }
    );
    ipcMain.handle(
      "workspace:purge-backups",
      async (_event, params: { fileId: string }) => {
        return this.purgeBackups(params.fileId);
      }
    );
    ipcMain.handle(
      "workspace:list-backups",
      async (_event, params: { fileId: string }) => {
        const paths = await this.listBackups(params.fileId);
        return { backupPaths: paths };
      }
    );
    ipcMain.handle(
      "workspace:read-backup",
      async (_event, params: { fileId: string }) => {
        return this.readLatestBackup(params.fileId);
      }
    );
  }

  public async saveBackup(fileId: string, text: string): Promise<{ backupUri: string }> {
    await mkdir(this.backupsDir, { recursive: true });
    const sequence = this.now();
    const fileName = `${fileId}.${sequence}${BACKUP_SUFFIX}`;
    const finalPath = join(this.backupsDir, fileName);
    const tempPath = `${finalPath}.tmp`;
    await writeFile(tempPath, text, "utf8");
    await rename(tempPath, finalPath);
    await this.enforceRetention(fileId, fileName);
    return { backupUri: pathToFileURL(finalPath).toString() };
  }

  public async purgeBackups(fileId: string): Promise<{ purged: number }> {
    try {
      const entries = await readdir(this.backupsDir);
      const pattern = new RegExp(`^${escapeForRegex(fileId)}\\.\\d+\\${BACKUP_SUFFIX}$`);
      let purged = 0;
      for (const name of entries) {
        if (pattern.test(name)) {
          await unlink(join(this.backupsDir, name)).catch(() => {});
          purged += 1;
        }
      }
      return { purged };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return { purged: 0 };
      }
      this.logError(
        `Failed to purge backups for ${fileId}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return { purged: 0 };
    }
  }

  public async readLatestBackup(
    fileId: string
  ): Promise<{ text: string; savedAt: string; backupUri: string } | null> {
    const paths = await this.listBackups(fileId);
    if (paths.length === 0) {
      return null;
    }
    const latest = paths[paths.length - 1]!;
    try {
      const [text, stats] = await Promise.all([
        readFile(latest, "utf8"),
        stat(latest)
      ]);
      return {
        text,
        savedAt: stats.mtime.toISOString(),
        backupUri: pathToFileURL(latest).toString()
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  public async listBackups(fileId: string): Promise<string[]> {
    try {
      const entries = await readdir(this.backupsDir);
      const pattern = new RegExp(`^${escapeForRegex(fileId)}\\.(\\d+)\\${BACKUP_SUFFIX}$`);
      return entries
        .filter((name) => pattern.test(name))
        .sort()
        .map((name) => join(this.backupsDir, name));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async enforceRetention(fileId: string, justWritten: string): Promise<void> {
    try {
      const entries = await readdir(this.backupsDir);
      const pattern = new RegExp(`^${escapeForRegex(fileId)}\\.(\\d+)\\${BACKUP_SUFFIX}$`);
      const matching = entries
        .filter((name) => pattern.test(name))
        .sort();

      const excess = matching.length - this.retention;
      if (excess <= 0) {
        return;
      }
      const toDelete = matching.slice(0, excess);
      for (const name of toDelete) {
        if (name === justWritten) {
          continue;
        }
        await unlink(join(this.backupsDir, name)).catch(() => {});
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return;
      }
      this.logError(
        `Failed to enforce backup retention for ${fileId}`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }
}

export function defaultBackupsDir(userDataDir: string): string {
  return join(userDataDir, "backups");
}
