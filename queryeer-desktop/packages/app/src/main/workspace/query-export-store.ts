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
  // Chains append operations per stream so finalizeStream can await all pending writes.
  private readonly appendChainByKey = new Map<string, Promise<void>>();

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
    // Use wx flag so we don't overwrite if appendChunk already created the file
    // (race between openExportStream and appendExportChunk on the same (executionId, resultSetIndex)).
    try {
      await writeFile(path, "", { flag: "wx" });
    } catch {
      // File already exists — nothing to do
    }
  }

  public async appendChunk(params: ExportAppendParams): Promise<void> {
    const key = this.key(params);
    const payload = params.rows
      .map((row) => JSON.stringify(row))
      .join("\n");
    if (payload.length === 0) {
      return;
    }

    // Fast path: when the path is already known (openStream was called first),
    // set up the chain entry synchronously before any await. This is critical
    // for correctness when appendChunk is called concurrently without awaiting
    // (fire-and-forget IPC pattern): callers that arrive before any yield still
    // see each other's chain entries and form a complete serialised chain that
    // finalizeStream can await.
    const knownPath = this.pathsByKey.get(key);
    if (knownPath) {
      const prev = this.appendChainByKey.get(key) ?? Promise.resolve();
      const next = prev.then(() => appendFile(knownPath, `${payload}\n`, "utf8"));
      this.appendChainByKey.set(key, next);
      await next;
      return;
    }

    // Slow path: openStream was not called first — resolve the path first.
    const path = await this.ensurePath(params);
    const prev = this.appendChainByKey.get(key) ?? Promise.resolve();
    const next = prev.then(() => appendFile(path, `${payload}\n`, "utf8"));
    this.appendChainByKey.set(key, next);
    await next;
  }

  public async finalizeStream(params: ExportParams): Promise<string> {
    const key = this.key(params);
    // Wait for all in-flight appends before handing back the path so callers
    // get a complete file when they subsequently read it.
    const pending = this.appendChainByKey.get(key);
    if (pending) {
      await pending;
    }
    this.appendChainByKey.delete(key);
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
