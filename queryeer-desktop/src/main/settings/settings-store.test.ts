import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SETTINGS_INDEX_VERSION,
  SETTINGS_MODULE_VERSION
} from "../../contracts/settings/SettingsDocuments.js";
import { SettingsStore } from "./settings-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-settings-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeStore(): { store: SettingsStore; settingsDir: string } {
  const settingsDir = join(workDir, "settings");
  const store = new SettingsStore({ settingsDirPath: settingsDir });
  return { store, settingsDir };
}

describe("SettingsStore read", () => {
  it("returns empty documents when files do not exist", async () => {
    const { store } = makeStore();
    const index = await store.readIndex();
    const moduleDoc = await store.readModule("core.editor");

    expect(index.version).toBe(SETTINGS_INDEX_VERSION);
    expect(index.modules).toEqual({});
    expect(moduleDoc.version).toBe(SETTINGS_MODULE_VERSION);
    expect(moduleDoc.moduleId).toBe("core.editor");
    expect(moduleDoc.values).toEqual({});
  });

  it("returns empty document for schema mismatch", async () => {
    const { store, settingsDir } = makeStore();
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "index.json"), JSON.stringify({ version: 999 }), "utf8");
    writeFileSync(
      join(settingsDir, "core.editor.json"),
      JSON.stringify({ version: 999, moduleId: "core.editor", values: { x: 1 } }),
      "utf8"
    );

    const index = await store.readIndex();
    const moduleDoc = await store.readModule("core.editor");

    expect(index.modules).toEqual({});
    expect(moduleDoc.values).toEqual({});
  });

  it("quarantines broken json and returns defaults", async () => {
    const { store, settingsDir } = makeStore();
    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, "core.editor.json"), "{ broken", "utf8");

    const moduleDoc = await store.readModule("core.editor");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(moduleDoc.values).toEqual({});
    const entries = readdirSync(settingsDir);
    expect(entries.some((entry) => entry.startsWith("core.editor.json.broken-"))).toBe(true);
  });
});

describe("SettingsStore write", () => {
  it("writes index and module documents atomically", async () => {
    const { store, settingsDir } = makeStore();
    await store.writeIndex({
      version: SETTINGS_INDEX_VERSION,
      updatedAt: "stale",
      modules: {
        "core.editor": {
          file: "core.editor.json",
          version: SETTINGS_MODULE_VERSION,
          updatedAt: "stale"
        }
      }
    });
    await store.writeModule("core.editor", {
      version: SETTINGS_MODULE_VERSION,
      moduleId: "core.editor",
      updatedAt: "stale",
      values: {
        "core.editor.tabSize": 2
      }
    });

    const persistedIndex = JSON.parse(readFileSync(join(settingsDir, "index.json"), "utf8"));
    const persistedModule = JSON.parse(readFileSync(join(settingsDir, "core.editor.json"), "utf8"));
    expect(persistedIndex.modules["core.editor"].file).toBe("core.editor.json");
    expect(persistedModule.values["core.editor.tabSize"]).toBe(2);
    expect(existsSync(join(settingsDir, "index.json.tmp"))).toBe(false);
    expect(existsSync(join(settingsDir, "core.editor.json.tmp"))).toBe(false);
  });
});
