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
  // Chains stream operations so finalizeStream can await fire-and-forget opens and appends.
  private readonly streamChainByKey = new Map<string, Promise<void>>();

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
    const previous = this.streamChainByKey.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      const path = await this.ensurePath(params);
      // Use wx so a late open cannot overwrite rows already appended to the stream.
      try {
        await writeFile(path, "", { flag: "wx" });
      } catch {
        // File already exists — nothing to do
      }
    });
    this.streamChainByKey.set(key, next);
    await next;
  }

  public async appendChunk(params: ExportAppendParams): Promise<void> {
    const key = this.key(params);
    const payload = params.rows
      .map((row) => JSON.stringify(row))
      .join("\n");
    if (payload.length === 0) {
      return;
    }

    // Register the append before any asynchronous path work so finalization
    // cannot overtake fire-and-forget IPC calls from the renderer.
    const previous = this.streamChainByKey.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      const path = await this.ensurePath(params);
      await appendFile(path, `${payload}\n`, "utf8");
    });
    this.streamChainByKey.set(key, next);
    await next;
  }

  public async finalizeStream(params: ExportParams): Promise<string> {
    const key = this.key(params);
    // Wait for all in-flight appends before handing back the path so callers
    // get a complete file when they subsequently read it.
    const pending = this.streamChainByKey.get(key);
    if (pending) {
      await pending;
    }
    this.streamChainByKey.delete(key);
    const path = await this.ensurePath(params);
    this.pathsByKey.delete(key);
    return pathToFileURL(path).toString();
  }

  private async ensurePath(params: ExportParams): Promise<string> {
    const key = this.key(params);
    const existing = this.pathsByKey.get(key);
    if (existing) {
      return existing;
    }

    const name = `${safeSegment(params.executionId)}.${params.resultSetIndex}.${Date.now()}${EXTENSION}`;
    const path = join(this.exportsDir, name);
    // Reserve the path before yielding so concurrent operations share one file.
    this.pathsByKey.set(key, path);
    await mkdir(this.exportsDir, { recursive: true });
    return path;
  }

  private key(params: ExportParams): string {
    return `${params.executionId}:${params.resultSetIndex}`;
  }
}

export function defaultExportsDir(userDataDir: string): string {
  return join(userDataDir, "exports");
}
