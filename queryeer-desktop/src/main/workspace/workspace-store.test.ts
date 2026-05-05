import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_SCHEMA_VERSION } from "../../contracts/workspace/WorkspaceSnapshot.js";
import { WorkspaceStore } from "./workspace-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-workspace-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeStore(debounceMs = 25): { store: WorkspaceStore; path: string } {
  const path = join(workDir, "workspace.json");
  const store = new WorkspaceStore({ workspaceFilePath: path, debounceMs });
  return { store, path };
}

describe("WorkspaceStore.read", () => {
  it("returns an empty snapshot when the file does not exist", async () => {
    const { store } = makeStore();
    const snapshot = await store.read();
    expect(snapshot.schemaVersion).toBe(WORKSPACE_SCHEMA_VERSION);
    expect(snapshot.files).toEqual([]);
  });

  it("returns an empty snapshot when schemaVersion does not match", async () => {
    const { store, path } = makeStore();
    writeFileSync(
      path,
      JSON.stringify({ schemaVersion: 999, files: [{ uri: "file:///x" }] }),
      "utf8"
    );
    const snapshot = await store.read();
    expect(snapshot.files).toEqual([]);
  });

  it("returns persisted files when present", async () => {
    const { store, path } = makeStore();
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        savedAt: "2026-04-21T00:00:00.000Z",
        activeFileUri: "file:///a.txt",
        files: [{ uri: "file:///a.txt", mimeType: "text/plain" }]
      }),
      "utf8"
    );
    const snapshot = await store.read();
    expect(snapshot.activeFileUri).toBe("file:///a.txt");
    expect(snapshot.files).toHaveLength(1);
  });

  it("ignores legacy persisted untitledCounter when present", async () => {
    const { store, path } = makeStore();
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        savedAt: "2026-04-21T00:00:00.000Z",
        untitledCounter: 17,
        files: []
      }),
      "utf8"
    );
    const snapshot = await store.read();
    expect(snapshot).not.toHaveProperty("untitledCounter");
  });
});

describe("WorkspaceStore.scheduleSave + flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces multiple scheduleSave calls into one write", async () => {
    const { store, path } = makeStore(50);
    store.scheduleSave({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t1",
      files: [{ uri: "file:///a.txt", mimeType: "text/plain" }]
    });
    store.scheduleSave({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t2",
      files: [{ uri: "file:///b.txt", mimeType: "text/plain" }]
    });

    await vi.advanceTimersByTimeAsync(60);
    await store.flush();

    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.savedAt).toBe("t2");
    expect(persisted.files[0].uri).toBe("file:///b.txt");
  });

  it("flush forces an immediate write of the pending snapshot", async () => {
    const { store, path } = makeStore(10_000);
    store.scheduleSave({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t1",
      files: []
    });

    await store.flush();

    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.savedAt).toBe("t1");
  });

  it("does not persist untitledCounter on save", async () => {
    const { store, path } = makeStore(10_000);
    store.scheduleSave({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t1",
      files: []
    });

    await store.flush();

    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted).not.toHaveProperty("untitledCounter");
  });

  it("dispose cancels pending timer without writing", () => {
    const { store, path } = makeStore(50);
    store.scheduleSave({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t1",
      files: []
    });

    store.dispose();
    vi.advanceTimersByTime(100);

    expect(() => readFileSync(path, "utf8")).toThrow();
  });
});

describe("WorkspaceStore atomic write", () => {
  it("writes through a temp file before rename", async () => {
    const { store, path } = makeStore();
    store.scheduleSave({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "atomic",
      files: []
    });
    await store.flush();

    expect(readFileSync(path, "utf8")).toContain("atomic");
    expect(() => readFileSync(`${path}.tmp`, "utf8")).toThrow();
  });
});
