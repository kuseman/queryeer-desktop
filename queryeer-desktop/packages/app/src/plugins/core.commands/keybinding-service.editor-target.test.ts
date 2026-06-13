import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import { KEYBINDINGS_SCHEMA_VERSION } from "@queryeer/api/commands/Keybindings";
import { createContextChain } from "./context-chain";
import { createKeybindingService } from "./keybinding-service";

const originalAppShell = window.appShell;

beforeEach(() => {
  window.appShell = {
    ...window.appShell,
    evaluateExpressionSync: (params) => {
      try {
        const keys = Object.keys(params.context);
        const values = keys.map((key) => params.context[key]);
        const runner = new Function(...keys, `return (${params.expression});`) as (...args: unknown[]) => unknown;
        return { ok: true as const, result: runner(...values) };
      } catch (error) {
        return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
      }
    }
  };
});

afterEach(() => {
  window.appShell = originalAppShell;
});

function makeExtensions(): ExtensionSnapshot {
  return {
    commands: [
      { id: "core.files.save", title: "Save", handler: () => {} }
    ],
    filesystems: [],
    files: [],
    menu: { items: [] },
    keybindings: [],
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

describe("createKeybindingService editor target fallback", () => {
  it("executes editorFocus keybinding when context chain has stale editorFocus=false", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const chain = createContextChain();
    chain.register({
      id: "zone",
      priority: 20,
      context: { editorFocus: false, editorTextFocus: false, inputFocus: false }
    });

    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Ctrl+S", when: "editorFocus", scope: "editor" }],
        unbound: []
      }),
      contextChain: chain
    });

    await service.initialize(makeExtensions());

    const editorPane = document.createElement("div");
    editorPane.className = "shell-editor-pane";
    document.body.appendChild(editorPane);

    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    editorPane.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.files.save");
    expect(event.defaultPrevented).toBe(true);

    document.body.removeChild(editorPane);
    service.dispose();
  });
});
