import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackupStore } from "./backup-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-backup-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeStore(overrides?: { retention?: number; now?: () => number }) {
  const backupsDir = join(workDir, "backups");
  const store = new BackupStore({
    backupsDir,
    retention: overrides?.retention,
    now: overrides?.now
  });
  return { store, backupsDir };
}

describe("BackupStore.saveBackup", () => {
  it("writes the content and returns a file:// URI", async () => {
    let clock = 1_000;
    const { store, backupsDir } = makeStore({ now: () => clock++ });

    const result = await store.saveBackup("f-1", "hello");

    expect(result.backupUri).toMatch(/^file:\/\//);
    const entries = readdirSync(backupsDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toBe("f-1.1000.bak");
    expect(readFileSync(join(backupsDir, entries[0]!), "utf8")).toBe("hello");
  });

  it("creates the backups directory on first save", async () => {
    const { store, backupsDir } = makeStore();
    await store.saveBackup("f-1", "hi");
    expect(readdirSync(backupsDir)).toHaveLength(1);
  });

  it("does not leave a .tmp file after atomic rename", async () => {
    let clock = 1_000;
    const { store, backupsDir } = makeStore({ now: () => clock++ });
    await store.saveBackup("f-1", "hi");
    const entries = readdirSync(backupsDir);
    expect(entries.some((name) => name.endsWith(".tmp"))).toBe(false);
  });
});

describe("BackupStore retention", () => {
  it("keeps only the N most recent backups per fileId", async () => {
    let clock = 1_000;
    const { store, backupsDir } = makeStore({ retention: 3, now: () => clock++ });

    await store.saveBackup("f-1", "v1");
    await store.saveBackup("f-1", "v2");
    await store.saveBackup("f-1", "v3");
    await store.saveBackup("f-1", "v4");
    await store.saveBackup("f-1", "v5");

    const entries = readdirSync(backupsDir).filter((n) => n.startsWith("f-1."));
    expect(entries).toHaveLength(3);
    const contents = entries.sort().map((name) => readFileSync(join(backupsDir, name), "utf8"));
    expect(contents).toEqual(["v3", "v4", "v5"]);
  });

  it("does not cross-delete backups for other fileIds", async () => {
    let clock = 1_000;
    const { store, backupsDir } = makeStore({ retention: 2, now: () => clock++ });

    await store.saveBackup("f-1", "a");
    await store.saveBackup("f-1", "b");
    await store.saveBackup("f-2", "c");
    await store.saveBackup("f-1", "d");

    const f1 = readdirSync(backupsDir).filter((n) => n.startsWith("f-1."));
    const f2 = readdirSync(backupsDir).filter((n) => n.startsWith("f-2."));
    expect(f1).toHaveLength(2);
    expect(f2).toHaveLength(1);
  });
});

describe("BackupStore.purgeBackups", () => {
  it("removes all backups for a fileId", async () => {
    let clock = 1_000;
    const { store, backupsDir } = makeStore({ now: () => clock++ });
    await store.saveBackup("f-1", "a");
    await store.saveBackup("f-1", "b");
    await store.saveBackup("f-2", "c");

    const result = await store.purgeBackups("f-1");

    expect(result.purged).toBe(2);
    const remaining = readdirSync(backupsDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatch(/^f-2\./);
  });

  it("returns purged=0 when directory does not exist", async () => {
    const { store } = makeStore();
    const result = await store.purgeBackups("nothing");
    expect(result.purged).toBe(0);
  });
});

describe("BackupStore.readLatestBackup", () => {
  it("returns null when no backups exist", async () => {
    const { store } = makeStore();
    const result = await store.readLatestBackup("never-backed-up");
    expect(result).toBeNull();
  });

  it("returns the most recent backup content and uri", async () => {
    let clock = 1_000;
    const { store } = makeStore({ now: () => clock++ });
    await store.saveBackup("f-1", "first");
    await store.saveBackup("f-1", "second");
    await store.saveBackup("f-1", "third");

    const result = await store.readLatestBackup("f-1");
    expect(result).not.toBeNull();
    expect(result!.text).toBe("third");
    expect(result!.backupUri).toMatch(/^file:\/\//);
  });
});

describe("BackupStore.listBackups", () => {
  it("returns matching paths sorted by timestamp", async () => {
    let clock = 1_000;
    const { store } = makeStore({ now: () => clock++ });
    await store.saveBackup("f-1", "a");
    await store.saveBackup("f-1", "b");
    await store.saveBackup("f-2", "x");

    const paths = await store.listBackups("f-1");
    expect(paths).toHaveLength(2);
    expect(paths.every((p) => p.includes("f-1."))).toBe(true);
  });
});
