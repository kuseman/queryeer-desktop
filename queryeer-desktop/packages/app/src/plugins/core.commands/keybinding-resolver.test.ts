import { describe, expect, it } from "vitest";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import {
  emptyUserKeybindingsDocument,
  KEYBINDINGS_SCHEMA_VERSION
} from "@queryeer/api/commands/Keybindings";
import { resolveKeybindingState } from "./keybinding-resolver";

function baseExtensions(): ExtensionSnapshot {
  return {
    commands: [
      {
        id: "core.commands.about",
        title: "About",
        handler: () => {}
      },
      {
        id: "core.files.save",
        title: "Save",
        handler: () => {}
      }
    ],
    filesystems: [],
    files: [],
    menu: { items: [] },
    keybindings: [
      {
        id: "k1",
        commandId: "core.commands.about",
        key: "F1",
        when: "global",
        scope: "global",
        order: 10
      }
    ],
    layout: {
      toolbarActions: [],
      statusItems: [],
      views: [],
      editors: [],
      welcomes: [],
      tabContextMenus: [],
      tabHeaderStyles: [],
      tabTitles: [],
      panels: [],
      shellDefaults: {
        visibleZones: ["mainArea", "statusBar"],
        sidebarWidths: { primary: 280, secondary: 320 },
        statusBarHeight: 24
      }
    },
    tooltip: { sections: [] },
    settings: {
      contributions: [],
      definitions: [],
      advancedRendererIds: [],
      advancedValidatorIds: []
    }
  };
}

describe("resolveKeybindingState", () => {
  it("uses defaults when user document is empty", () => {
    const state = resolveKeybindingState(baseExtensions(), emptyUserKeybindingsDocument());
    expect(state.resolved.some((item) => item.commandId === "core.commands.about")).toBe(true);
    expect(state.diagnostics.invalidUserBindings).toHaveLength(0);
  });

  it("accepts valid user overrides", () => {
    const state = resolveKeybindingState(baseExtensions(), {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [{ commandId: "core.files.save", key: "CmdOrCtrl+S", when: "global" }],
      unbound: []
    });
    expect(state.resolved.some((item) => item.commandId === "core.files.save")).toBe(true);
  });

  it("reports unknown command user bindings", () => {
    const state = resolveKeybindingState(baseExtensions(), {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [{ commandId: "missing.command", key: "F6" }],
      unbound: []
    });
    expect(state.diagnostics.invalidUserBindings).toHaveLength(1);
    expect(state.diagnostics.invalidUserBindings[0]?.reason).toBe("unknown-command");
  });

  it("turns off default bindings through unbound entries", () => {
    const state = resolveKeybindingState(baseExtensions(), {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [],
      unbound: [{ commandId: "core.commands.about" }]
    });
    expect(state.resolved.some((item) => item.commandId === "core.commands.about")).toBe(false);
  });

  it("normalizes ESC alias to Escape", () => {
    const state = resolveKeybindingState(baseExtensions(), {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [{ commandId: "core.files.save", key: "ESC", when: "global" }],
      unbound: []
    });
    const escBinding = state.resolved.find((item) => item.commandId === "core.files.save");
    expect(escBinding?.normalizedKey).toBe("escape");
  });
});
