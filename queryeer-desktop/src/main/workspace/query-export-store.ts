import { ipcMain } from "electron";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type ExportParams = { executionId: string; resultSetIndex: number };
type ExportAppendParams = ExportParams & { rows: unknown[][] };

const EXTENSION = ".ndjson";

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class QueryExportStore {
  private readonly exportsDir: string;
  private readonly pathsByKey = new Map<string, string>();

  public constructor(exportsDir: string) {
    this.exportsDir = exportsDir;
  }

  public wireIpc(): void {
    ipcMain.handle("workspace:export-open", async (_event, params: ExportParams) => {
      await this.openStream(params);
    });
    ipcMain.handle("workspace:export-append", async (_event, params: ExportAppendParams) => {
      await this.appendChunk(params);
    });
    ipcMain.handle("workspace:export-finalize", async (_event, params: ExportParams) => {
      const exportPath = await this.finalizeStream(params);
      return { exportPath };
    });
  }

  public async openStream(params: ExportParams): Promise<void> {
    const key = this.key(params);
    const path = await this.ensurePath(params);
    this.pathsByKey.set(key, path);
    await writeFile(path, "", "utf8");
  }

  public async appendChunk(params: ExportAppendParams): Promise<void> {
    const path = await this.ensurePath(params);
    const payload = params.rows
      .map((row) => JSON.stringify(row))
      .join("\n");
    if (payload.length === 0) {
      return;
    }
    await appendFile(path, `${payload}\n`, "utf8");
  }

  public async finalizeStream(params: ExportParams): Promise<string> {
    const path = await this.ensurePath(params);
    this.pathsByKey.delete(this.key(params));
    return pathToFileURL(path).toString();
  }

  private async ensurePath(params: ExportParams): Promise<string> {
    const key = this.key(params);
    const existing = this.pathsByKey.get(key);
    if (existing) {
      return existing;
    }

    await mkdir(this.exportsDir, { recursive: true });
    const name = `${safeSegment(params.executionId)}.${params.resultSetIndex}.${Date.now()}${EXTENSION}`;
    const path = join(this.exportsDir, name);
    this.pathsByKey.set(key, path);
    return path;
  }

  private key(params: ExportParams): string {
    return `${params.executionId}:${params.resultSetIndex}`;
  }
}

export function defaultExportsDir(userDataDir: string): string {
  return join(userDataDir, "exports");
}
