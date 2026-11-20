import { ipcMain } from "electron";
import { mkdir, open, rename, rm } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

type ExportParams = { executionId: string; resultSetIndex: number };
type ExportAppendParams = ExportParams & { rows: unknown[][] };
type ExportAppendTextParams = ExportParams & { text: string };
type ExportOpenParams = ExportParams & { targetPath?: string };

const EXTENSION = ".ndjson";
const PARTIAL_EXTENSION = ".partial";

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class QueryExportStore {
  private readonly exportsDir: string;
  private readonly pathsByKey = new Map<string, string>();
  // Streams written next to their final destination and renamed over it on finalize.
  private readonly targetsByKey = new Map<string, string>();
  // One open handle per stream: reopening the file for every chunk is very slow on Windows.
  private readonly handlesByKey = new Map<string, FileHandle>();
  // Chains stream operations so finalizeStream can await fire-and-forget opens and appends.
  private readonly streamChainByKey = new Map<string, Promise<void>>();

  public constructor(exportsDir: string) {
    this.exportsDir = exportsDir;
  }

  public wireIpc(): void {
    ipcMain.handle("workspace:export-open", async (_event, params: ExportOpenParams) => {
      await this.openStream(params);
    });
    ipcMain.handle("workspace:export-append", async (_event, params: ExportAppendParams) => {
      await this.appendChunk(params);
    });
    ipcMain.handle("workspace:export-append-text", async (_event, params: ExportAppendTextParams) => {
      await this.appendText(params);
    });
    ipcMain.handle("workspace:export-finalize", async (_event, params: ExportParams) => {
      const exportPath = await this.finalizeStream(params);
      return { exportPath };
    });
    ipcMain.handle("workspace:export-discard", async (_event, params: ExportParams) => {
      await this.discardStream(params);
    });
  }

  /**
   * Opens a stream. With `targetPath` the stream is written to a partial file next to that
   * target, so finalizing replaces the target in one rename and no copy.
   */
  public async openStream(params: ExportOpenParams): Promise<void> {
    const key = this.key(params);
    if (params.targetPath !== undefined && !this.pathsByKey.has(key)) {
      this.targetsByKey.set(key, params.targetPath);
    }
    const previous = this.streamChainByKey.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      // Append mode, so a late open cannot overwrite rows already appended to the stream.
      await this.ensureHandle(params);
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
      await (await this.ensureHandle(params)).appendFile(`${payload}\n`, "utf8");
    });
    this.streamChainByKey.set(key, next);
    await next;
  }

  /** Appends already-formatted text verbatim (no row encoding, no added newline). */
  public async appendText(params: ExportAppendTextParams): Promise<void> {
    if (params.text.length === 0) {
      return;
    }
    const key = this.key(params);
    const previous = this.streamChainByKey.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      await (await this.ensureHandle(params)).appendFile(params.text, "utf8");
    });
    this.streamChainByKey.set(key, next);
    await next;
  }

  /**
   * Waits for every in-flight write, then returns the finished file's URL. A stream opened with
   * a target path is renamed over that target, replacing it in one step.
   */
  public async finalizeStream(params: ExportParams): Promise<string> {
    const key = this.key(params);
    // Wait for all in-flight appends before handing back the path so callers
    // get a complete file when they subsequently read it.
    const pending = this.streamChainByKey.get(key);
    const targetPath = this.targetsByKey.get(key);
    let path: string | undefined;
    try {
      if (pending) {
        await pending;
      }
      path = await this.ensurePath(params);
      // Opening creates the file when the stream received nothing
      await this.ensureHandle(params);
      await this.closeHandle(key);
      if (targetPath === undefined) {
        return pathToFileURL(path).toString();
      }
      await rename(path, targetPath);
      return pathToFileURL(targetPath).toString();
    } catch (error) {
      await this.closeHandle(key).catch(() => {});
      // A failed write rejects `pending` before `path` is assigned; the map still knows it
      const partialPath = path ?? this.pathsByKey.get(key);
      if (targetPath !== undefined && partialPath !== undefined) {
        await rm(partialPath, { force: true }).catch(() => {});
      }
      throw error;
    } finally {
      this.forget(key);
    }
  }

  /** Abandons a stream: waits for its in-flight writes and deletes what was written. */
  public async discardStream(params: ExportParams): Promise<void> {
    const key = this.key(params);
    const pending = this.streamChainByKey.get(key);
    await pending?.catch(() => {});
    // Read after the wait: a stream's path is only reserved once its first step runs
    const path = this.pathsByKey.get(key);
    await this.closeHandle(key).catch(() => {});
    this.forget(key);
    if (path !== undefined) {
      await rm(path, { force: true });
    }
  }

  private async ensureHandle(params: ExportParams): Promise<FileHandle> {
    const key = this.key(params);
    const existing = this.handlesByKey.get(key);
    if (existing) {
      return existing;
    }
    const handle = await open(await this.ensurePath(params), "a");
    this.handlesByKey.set(key, handle);
    return handle;
  }

  private async closeHandle(key: string): Promise<void> {
    const handle = this.handlesByKey.get(key);
    this.handlesByKey.delete(key);
    await handle?.close();
  }

  private forget(key: string): void {
    this.streamChainByKey.delete(key);
    this.pathsByKey.delete(key);
    this.targetsByKey.delete(key);
  }

  private async ensurePath(params: ExportParams): Promise<string> {
    const key = this.key(params);
    const existing = this.pathsByKey.get(key);
    if (existing) {
      return existing;
    }

    const targetPath = this.targetsByKey.get(key);
    const directory = targetPath === undefined ? this.exportsDir : dirname(targetPath);
    const path = targetPath === undefined
      ? join(directory, `${safeSegment(params.executionId)}.${params.resultSetIndex}.${Date.now()}${EXTENSION}`)
      : `${targetPath}.${safeSegment(params.executionId)}${PARTIAL_EXTENSION}`;
    // Reserve the path before yielding so concurrent operations share one file.
    this.pathsByKey.set(key, path);
    await mkdir(directory, { recursive: true });
    return path;
  }

  private key(params: ExportParams): string {
    return `${params.executionId}:${params.resultSetIndex}`;
  }
}

export function defaultExportsDir(userDataDir: string): string {
  return join(userDataDir, "exports");
}
