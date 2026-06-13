import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultWindowStatePath,
  type WindowStateSnapshot,
  WindowStateStore
} from "./window-state-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-window-state-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeStore(debounceMs = 10): { store: WindowStateStore; path: string } {
  const path = join(workDir, "window-state.json");
  const store = new WindowStateStore({
    windowStatePath: path,
    debounceMs,
    now: () => "2026-01-01T00:00:00.000Z"
  });
  return { store, path };
}

function snapshot(overrides: Partial<WindowStateSnapshot> = {}): WindowStateSnapshot {
  return {
    bounds: { x: 10, y: 20, width: 1200, height: 780 },
    maximized: false,
    ...overrides
  };
}

describe("WindowStateStore.read", () => {
  it("returns null when file does not exist", async () => {
    const { store } = makeStore();
    await expect(store.read()).resolves.toBeNull();
  });

  it("returns null when version mismatches", async () => {
    const { store, path } = makeStore();
    writeFileSync(path, JSON.stringify({ version: 999, bounds: { x: 1, y: 1, width: 1, height: 1 }, maximized: true }), "utf8");

    await expect(store.read()).resolves.toBeNull();
  });

  it("returns null when bounds are invalid", async () => {
    const { store, path } = makeStore();
    writeFileSync(path, JSON.stringify({ version: 1, bounds: { x: 0, y: 0, width: 0, height: 800 }, maximized: true }), "utf8");

    await expect(store.read()).resolves.toBeNull();
  });

  it("returns persisted snapshot when valid", async () => {
    const { store, path } = makeStore();
    writeFileSync(path, JSON.stringify({
      version: 1,
      updatedAt: "2026-01-01T00:00:00.000Z",
      bounds: { x: 11.2, y: 21.7, width: 1280.6, height: 801.4 },
      maximized: true
    }), "utf8");

    await expect(store.read()).resolves.toEqual({
      bounds: { x: 11, y: 22, width: 1281, height: 801 },
      maximized: true
    });
  });
});

describe("WindowStateStore.save", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces scheduleSave and persists latest snapshot", async () => {
    const { store, path } = makeStore(25);

    store.scheduleSave(snapshot({ bounds: { x: 1, y: 2, width: 1000, height: 700 } }));
    store.scheduleSave(snapshot({ bounds: { x: 3, y: 4, width: 1100, height: 710 }, maximized: true }));

    await vi.advanceTimersByTimeAsync(30);
    await store.flush();

    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.bounds).toEqual({ x: 3, y: 4, width: 1100, height: 710 });
    expect(persisted.maximized).toBe(true);
    expect(persisted.updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("ignores invalid snapshots", async () => {
    const { store } = makeStore();
    const invalid = {
      bounds: { x: 0, y: 0, width: 0, height: 100 },
      maximized: false
    } as WindowStateSnapshot;

    store.scheduleSave(invalid);
    await vi.advanceTimersByTimeAsync(20);
    await store.flush();

    await expect(store.read()).resolves.toBeNull();
  });

  it("flush writes pending snapshot immediately", async () => {
    const { store, path } = makeStore(10_000);
    store.scheduleSave(snapshot({ maximized: true }));
    await store.flush();

    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.maximized).toBe(true);
  });
});

describe("defaultWindowStatePath", () => {
  it("stores window state under settings", () => {
    const path = defaultWindowStatePath("/user/data");
    expect(path).toContain("settings");
    expect(path).toContain("window-state.json");
  });
});
