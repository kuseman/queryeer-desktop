import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyUserKeybindingsDocument,
  KEYBINDINGS_SCHEMA_VERSION
} from "@queryeer/api/commands/Keybindings.js";
import { KeybindingsStore } from "./keybindings-store.js";

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), "queryeer-keybindings-"));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeStore(): { store: KeybindingsStore; path: string } {
  const path = join(workDir, "keybindings.json");
  return {
    store: new KeybindingsStore({ keybindingsFilePath: path }),
    path
  };
}

describe("KeybindingsStore.read", () => {
  it("returns empty document when file is missing", async () => {
    const { store } = makeStore();
    const document = await store.read();
    expect(document).toEqual(emptyUserKeybindingsDocument());
  });

  it("returns empty document on schema mismatch", async () => {
    const { store, path } = makeStore();
    writeFileSync(path, JSON.stringify({ version: 999, bindings: [], unbound: [] }), "utf8");
    const document = await store.read();
    expect(document).toEqual(emptyUserKeybindingsDocument());
  });

  it("returns persisted document", async () => {
    const { store, path } = makeStore();
    writeFileSync(
      path,
      JSON.stringify({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "CmdOrCtrl+S", when: "editorFocus" }],
        unbound: [{ commandId: "core.menu.view.commandPalette", when: "global" }]
      }),
      "utf8"
    );

    const document = await store.read();
    expect(document.bindings).toHaveLength(1);
    expect(document.unbound).toHaveLength(1);
  });
});

describe("KeybindingsStore.write", () => {
  it("writes through temp file and rename", async () => {
    const { store, path } = makeStore();
    await store.write({
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [{ commandId: "core.commands.about", key: "F1" }],
      unbound: []
    });

    const persisted = JSON.parse(readFileSync(path, "utf8"));
    expect(persisted.bindings[0].commandId).toBe("core.commands.about");
    expect(() => readFileSync(`${path}.tmp`, "utf8")).toThrow();
  });
});
