import { describe, expect, it, vi } from "vitest";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import { KEYBINDINGS_SCHEMA_VERSION } from "../../contracts/commands/Keybindings";
import { createKeybindingService } from "./keybinding-service";

function makeExtensions(): ExtensionSnapshot {
  return {
    commands: [
      { id: "core.commands.about", title: "About", handler: () => {} },
      { id: "core.files.save", title: "Save", handler: () => {} }
    ],
    filesystems: [],
    files: [],
    menu: { items: [] },
    keybindings: [
      {
        id: "k.about",
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
      shellDefaults: {
        visibleZones: ["mainArea", "statusBar"],
        sidebarWidths: { primary: 280, secondary: 320 },
        statusBarHeight: 24
      }
    }
  };
}

describe("createKeybindingService", () => {
  it("executes matching keybinding", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.commands.about", executed: true }));
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [],
        unbound: []
      })
    });

    await service.initialize(makeExtensions());

    const event = new KeyboardEvent("keydown", { key: "F1" });
    document.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.commands.about");
    service.dispose();
  });
});
