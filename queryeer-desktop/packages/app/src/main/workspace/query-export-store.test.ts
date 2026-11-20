import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultExportsDir, QueryExportStore } from "./query-export-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-export-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeStore(): QueryExportStore {
  return new QueryExportStore(workDir);
}

function readRows(url: string): unknown[][] {
  const filePath = fileURLToPath(url);
  const content = readFileSync(filePath, "utf8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown[]);
}

const BASE = { executionId: "exec-1", resultSetIndex: 0 };

describe("QueryExportStore.openStream", () => {
  it("creates an empty file at the expected path", async () => {
    const store = makeStore();
    await store.openStream(BASE);
    const url = await store.finalizeStream(BASE);
    const rows = readRows(url);
    expect(rows).toEqual([]);
  });

  it("returns a file:// URL from finalizeStream", async () => {
    const store = makeStore();
    await store.openStream(BASE);
    const url = await store.finalizeStream(BASE);
    expect(url).toMatch(/^file:\/\//);
  });
});

describe("QueryExportStore.appendChunk", () => {
  it("appends a single chunk that is readable after finalize", async () => {
    const store = makeStore();
    await store.openStream(BASE);
    await store.appendChunk({ ...BASE, rows: [[1, "a"], [2, "b"]] });
    const url = await store.finalizeStream(BASE);
    expect(readRows(url)).toEqual([[1, "a"], [2, "b"]]);
  });

  it("preserves order across multiple sequential awaited chunks", async () => {
    const store = makeStore();
    await store.openStream(BASE);
    await store.appendChunk({ ...BASE, rows: [[1], [2], [3]] });
    await store.appendChunk({ ...BASE, rows: [[4], [5], [6]] });
    await store.appendChunk({ ...BASE, rows: [[7], [8], [9]] });
    const url = await store.finalizeStream(BASE);
    expect(readRows(url)).toEqual([[1], [2], [3], [4], [5], [6], [7], [8], [9]]);
  });

  it("skips empty rows without writing", async () => {
    const store = makeStore();
    await store.openStream(BASE);
    await store.appendChunk({ ...BASE, rows: [] });
    const url = await store.finalizeStream(BASE);
    expect(readRows(url)).toEqual([]);
  });

  it("works without a prior openStream call (slow path)", async () => {
    const store = makeStore();
    await store.appendChunk({ ...BASE, rows: [[42]] });
    const url = await store.finalizeStream(BASE);
    expect(readRows(url)).toEqual([[42]]);
  });
});

describe("QueryExportStore race condition — fire-and-forget concurrent appends", () => {
  it("finalizeStream awaits an append started while openStream is still pending", async () => {
    const store = makeStore();

    const open = store.openStream(BASE);
    const append = store.appendChunk({ ...BASE, rows: [[1, "alice"], [2, "bob"]] });
    const url = await store.finalizeStream(BASE);
    await Promise.all([open, append]);

    expect(readRows(url)).toEqual([[1, "alice"], [2, "bob"]]);
  });

  it("finalizeStream awaits all concurrent appendChunk operations started without await", async () => {
    const store = makeStore();
    await store.openStream(BASE);

    // Intentionally do NOT await these — simulates the fire-and-forget IPC pattern
    // where the renderer sends all chunks before awaiting finalize.
    const p1 = store.appendChunk({ ...BASE, rows: [[1], [2], [3]] });
    const p2 = store.appendChunk({ ...BASE, rows: [[4], [5], [6]] });
    const p3 = store.appendChunk({ ...BASE, rows: [[7], [8], [9]] });

    // finalizeStream must block until all three appends have completed.
    const url = await store.finalizeStream(BASE);
    await Promise.all([p1, p2, p3]);

    const rows = readRows(url);
    expect(rows).toHaveLength(9);
    // All rows must be present (order within the three batches may vary since
    // they raced, but each batch's own rows must be contiguous).
    const flat = rows.flat();
    for (let i = 1; i <= 9; i++) {
      expect(flat).toContain(i);
    }
  });

  it("handles many concurrent chunks without data loss", async () => {
    const store = makeStore();
    await store.openStream(BASE);

    const CHUNKS = 50;
    const ROWS_PER_CHUNK = 10;
    const promises: Promise<void>[] = [];
    for (let i = 0; i < CHUNKS; i++) {
      const rows = Array.from({ length: ROWS_PER_CHUNK }, (_, j) => [i * ROWS_PER_CHUNK + j]);
      promises.push(store.appendChunk({ ...BASE, rows }));
    }

    const url = await store.finalizeStream(BASE);
    await Promise.all(promises);

    const rows = readRows(url);
    expect(rows).toHaveLength(CHUNKS * ROWS_PER_CHUNK);
  });
});

describe("QueryExportStore stream isolation", () => {
  it("different resultSetIndex values write to separate files", async () => {
    const store = makeStore();
    const rs0 = { executionId: "exec-1", resultSetIndex: 0 };
    const rs1 = { executionId: "exec-1", resultSetIndex: 1 };

    await store.openStream(rs0);
    await store.openStream(rs1);
    await store.appendChunk({ ...rs0, rows: [["only-in-rs0"]] });
    await store.appendChunk({ ...rs1, rows: [["only-in-rs1"]] });

    const url0 = await store.finalizeStream(rs0);
    const url1 = await store.finalizeStream(rs1);

    expect(url0).not.toBe(url1);
    expect(readRows(url0)).toEqual([["only-in-rs0"]]);
    expect(readRows(url1)).toEqual([["only-in-rs1"]]);
  });

  it("different executionId values write to separate files", async () => {
    const store = makeStore();
    const e1 = { executionId: "exec-1", resultSetIndex: 0 };
    const e2 = { executionId: "exec-2", resultSetIndex: 0 };

    await store.openStream(e1);
    await store.openStream(e2);
    await store.appendChunk({ ...e1, rows: [["exec1-row"]] });
    await store.appendChunk({ ...e2, rows: [["exec2-row"]] });

    const url1 = await store.finalizeStream(e1);
    const url2 = await store.finalizeStream(e2);

    expect(url1).not.toBe(url2);
    expect(readRows(url1)).toEqual([["exec1-row"]]);
    expect(readRows(url2)).toEqual([["exec2-row"]]);
  });
});

describe("QueryExportStore target streams", () => {
  const STREAM = { executionId: "exec-1", resultSetIndex: -1 };

  it("writes next to the target and replaces it on finalize, leaving no partial file", async () => {
    const store = makeStore();
    const target = join(workDir, "out", "result.csv");
    mkdirSync(join(workDir, "out"));
    writeFileSync(target, "previous run");

    await store.openStream({ ...STREAM, targetPath: target });
    const p1 = store.appendText({ ...STREAM, text: "\"id\"" });
    const p2 = store.appendText({ ...STREAM, text: "\n\"1\"" });
    // The previous file stays intact until the new one is complete
    expect(readFileSync(target, "utf8")).toBe("previous run");
    const url = await store.finalizeStream(STREAM);
    await Promise.all([p1, p2]);

    expect(fileURLToPath(url)).toBe(target);
    expect(readFileSync(target, "utf8")).toBe("\"id\"\n\"1\"");
    expect(readdirSync(join(workDir, "out"))).toEqual(["result.csv"]);
  });

  it("creates an empty target when nothing was written", async () => {
    const store = makeStore();
    const target = join(workDir, "empty.csv");
    await store.openStream({ ...STREAM, targetPath: target });
    await store.finalizeStream(STREAM);
    expect(readFileSync(target, "utf8")).toBe("");
  });

  it("discard deletes the partial file and leaves the target untouched", async () => {
    const store = makeStore();
    const target = join(workDir, "keep.csv");
    writeFileSync(target, "keep me");
    await store.openStream({ ...STREAM, targetPath: target });
    await store.appendText({ ...STREAM, text: "half written" });

    await store.discardStream(STREAM);

    expect(readFileSync(target, "utf8")).toBe("keep me");
    expect(readdirSync(workDir)).toEqual(["keep.csv"]);
  });

  it("removes the partial file when a write fails mid-stream", async () => {
    const store = makeStore();
    const target = join(workDir, "out.csv");
    await store.openStream({ ...STREAM, targetPath: target });
    await store.appendText({ ...STREAM, text: "first chunk" });
    expect(readdirSync(workDir)).toHaveLength(1);
    // Simulate a failing disk write (e.g. ENOSPC): the stream's handle stops accepting writes
    const handles = (store as unknown as { handlesByKey: Map<string, { close: () => Promise<void> }> }).handlesByKey;
    await [...handles.values()][0].close();
    await expect(store.appendText({ ...STREAM, text: "second chunk" })).rejects.toThrow();

    await expect(store.finalizeStream(STREAM)).rejects.toThrow();
    expect(readdirSync(workDir)).toEqual([]);
  });

  it("rejects finalize when a write failed and cleans up the partial file", async () => {
    const store = makeStore();
    const target = join(workDir, "missing-dir-is-a-file", "out.csv");
    writeFileSync(join(workDir, "missing-dir-is-a-file"), "not a directory");
    await store.openStream({ ...STREAM, targetPath: target }).catch(() => {});

    await expect(store.finalizeStream(STREAM)).rejects.toThrow();
    expect(existsSync(target)).toBe(false);
  });
});

describe("defaultExportsDir", () => {
  it("nests exports under the given userData directory", () => {
    expect(defaultExportsDir("/some/user/data")).toBe(
      join("/some/user/data", "exports")
    );
  });
});
