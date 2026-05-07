import { ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  emptyWorkspaceSnapshot,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceSnapshot
} from "../../contracts/workspace/WorkspaceSnapshot.js";

export type WorkspaceStoreOptions = {
  workspaceFilePath: string;
  debounceMs?: number;
  logError?: (message: string, error: Error) => void;
};

const DEFAULT_DEBOUNCE_MS = 500;

export class WorkspaceStore {
  private readonly workspaceFilePath: string;
  private readonly debounceMs: number;
  private readonly logError: (message: string, error: Error) => void;
  private pendingSnapshot: WorkspaceSnapshot | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingFlush: Promise<void> | null = null;

  public constructor(options: WorkspaceStoreOptions) {
    this.workspaceFilePath = options.workspaceFilePath;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
  }

  public wireIpc(): void {
    ipcMain.handle("workspace:get", async () => this.read());
    ipcMain.handle("workspace:save", async (_event, snapshot: WorkspaceSnapshot) => {
      this.scheduleSave(snapshot);
      return { accepted: true };
    });
  }

  public async read(): Promise<WorkspaceSnapshot> {
    try {
      const raw = await readFile(this.workspaceFilePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
      if (parsed.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
        return emptyWorkspaceSnapshot();
      }
      return {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : new Date(0).toISOString(),
        activeFileUri: parsed.activeFileUri,
        files: Array.isArray(parsed.files) ? parsed.files : [],
        layout: parsed.layout
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return emptyWorkspaceSnapshot();
      }
      this.logError(
        `Failed to read workspace file at ${this.workspaceFilePath}`,
        error instanceof Error ? error : new Error(String(error))
      );
      return emptyWorkspaceSnapshot();
    }
  }

  public scheduleSave(snapshot: WorkspaceSnapshot): void {
    this.pendingSnapshot = snapshot;
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
    }
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  public async flush(): Promise<void> {
    if (this.pendingFlush) {
      await this.pendingFlush;
    }
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    const snapshot = this.pendingSnapshot;
    if (snapshot === null) {
      return;
    }
    this.pendingSnapshot = null;
    this.pendingFlush = this.writeAtomic(snapshot)
      .catch((error) => {
        this.logError(
          `Failed to write workspace file at ${this.workspaceFilePath}`,
          error instanceof Error ? error : new Error(String(error))
        );
      })
      .finally(() => {
        this.pendingFlush = null;
      });
    await this.pendingFlush;
  }

  public dispose(): void {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  private async writeAtomic(snapshot: WorkspaceSnapshot): Promise<void> {
    const dir = dirname(this.workspaceFilePath);
    await mkdir(dir, { recursive: true });
    const tempPath = `${this.workspaceFilePath}.tmp`;
    const payload = JSON.stringify(snapshot, null, 2);
    await writeFile(tempPath, payload, "utf8");
    await rename(tempPath, this.workspaceFilePath);
  }
}

export function defaultWorkspaceFilePath(userDataDir: string): string {
  return join(userDataDir, "settings", "workspace.json");
}
