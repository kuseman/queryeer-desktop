import { ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  emptySettingsIndexDocument,
  emptySettingsModuleDocument,
  SETTINGS_INDEX_VERSION,
  SETTINGS_MODULE_VERSION,
  type SettingsIndexDocument,
  type SettingsModuleDocument
} from "../../contracts/settings/SettingsDocuments.js";

export type SettingsStoreOptions = {
  settingsDirPath: string;
  logError?: (message: string, error: Error) => void;
  now?: () => Date;
};

export class SettingsStore {
  private readonly settingsDirPath: string;
  private readonly logError: (message: string, error: Error) => void;
  private readonly now: () => Date;

  public constructor(options: SettingsStoreOptions) {
    this.settingsDirPath = options.settingsDirPath;
    this.logError = options.logError ?? ((message, error) => console.error(message, error));
    this.now = options.now ?? (() => new Date());
  }

  public wireIpc(): void {
    ipcMain.handle("settings:get-index", async () => this.readIndex());
    ipcMain.handle("settings:get-module", async (_event, params: { moduleId: string }) => {
      return this.readModule(params.moduleId);
    });
    ipcMain.handle("settings:save-index", async (_event, document: SettingsIndexDocument) => {
      await this.writeIndex(document);
      return { accepted: true };
    });
    ipcMain.handle(
      "settings:save-module",
      async (_event, params: { moduleId: string; document: SettingsModuleDocument }) => {
        await this.writeModule(params.moduleId, params.document);
        return { accepted: true };
      }
    );
  }

  public async readIndex(): Promise<SettingsIndexDocument> {
    const path = this.indexFilePath();
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<SettingsIndexDocument>;
      if (parsed.version !== SETTINGS_INDEX_VERSION) {
        return emptySettingsIndexDocument();
      }
      return {
        version: SETTINGS_INDEX_VERSION,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
        modules: typeof parsed.modules === "object" && parsed.modules !== null ? parsed.modules : {}
      };
    } catch (error) {
      return this.handleReadError(path, error, emptySettingsIndexDocument());
    }
  }

  public async readModule(moduleId: string): Promise<SettingsModuleDocument> {
    const path = this.moduleFilePath(moduleId);
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<SettingsModuleDocument>;
      if (parsed.version !== SETTINGS_MODULE_VERSION || parsed.moduleId !== moduleId) {
        return emptySettingsModuleDocument(moduleId);
      }
      return {
        version: SETTINGS_MODULE_VERSION,
        moduleId,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
        values: typeof parsed.values === "object" && parsed.values !== null ? parsed.values : {}
      };
    } catch (error) {
      return this.handleReadError(path, error, emptySettingsModuleDocument(moduleId));
    }
  }

  public async writeIndex(document: SettingsIndexDocument): Promise<void> {
    await this.writeAtomic(this.indexFilePath(), {
      ...document,
      version: SETTINGS_INDEX_VERSION,
      updatedAt: this.now().toISOString()
    });
  }

  public async writeModule(moduleId: string, document: SettingsModuleDocument): Promise<void> {
    await this.writeAtomic(this.moduleFilePath(moduleId), {
      ...document,
      version: SETTINGS_MODULE_VERSION,
      moduleId,
      updatedAt: this.now().toISOString()
    });
  }

  private async writeAtomic(path: string, payload: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
    await rename(tempPath, path);
  }

  private async handleBrokenFile(path: string): Promise<void> {
    const stamp = this.now().toISOString().replace(/[:.]/g, "-");
    try {
      await rename(path, `${path}.broken-${stamp}`);
    } catch {
      // best effort only
    }
  }

  private handleReadError<T>(path: string, error: unknown, fallback: T): T {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return fallback;
    }
    if (error instanceof SyntaxError) {
      void this.handleBrokenFile(path);
      return fallback;
    }
    this.logError(
      `Failed to read settings file at ${path}`,
      error instanceof Error ? error : new Error(String(error))
    );
    return fallback;
  }

  private indexFilePath(): string {
    return join(this.settingsDirPath, "index.json");
  }

  private moduleFilePath(moduleId: string): string {
    return join(this.settingsDirPath, `${moduleId}.json`);
  }
}

export function defaultSettingsDirPath(userDataDir: string): string {
  return join(userDataDir, "settings");
}
