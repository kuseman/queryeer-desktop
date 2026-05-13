import { describe, expect, it, vi } from "vitest";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import { KEYBINDINGS_SCHEMA_VERSION, type UserKeybindingsDocument } from "../../contracts/commands/Keybindings";
import { createKeybindingService } from "./keybinding-service";
import { createContextChain } from "./context-chain";

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

  it("executes function keybinding even when input is focused", async () => {
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

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "F1", bubbles: true });
    input.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.commands.about");

    document.body.removeChild(input);
    service.dispose();
  });

  it("executes modified global keybinding when select input is focused", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Ctrl+S", when: "global", scope: "global" }],
        unbound: []
      })
    });

    await service.initialize(makeExtensions());

    const select = document.createElement("select");
    const option = document.createElement("option");
    option.value = "one";
    option.text = "One";
    select.appendChild(option);
    document.body.appendChild(select);
    select.focus();

    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true });
    select.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.files.save");

    document.body.removeChild(select);
    service.dispose();
  });

  it("reloads user keybindings on updateExtensions", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.commands.about", executed: true }));
    let current: UserKeybindingsDocument = {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [],
      unbound: []
    };
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => current
    });

    await service.initialize(makeExtensions());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F1" }));
    expect(executeCommand).toHaveBeenLastCalledWith("core.commands.about");

    current = {
      version: KEYBINDINGS_SCHEMA_VERSION,
      bindings: [{ commandId: "core.files.save", key: "F2", when: "global" }],
      unbound: []
    };
    await service.updateExtensions(makeExtensions());

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "F2" }));
    expect(executeCommand).toHaveBeenLastCalledWith("core.files.save");
    service.dispose();
  });

  it("executes editorFocus keybinding while editor input is focused", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Ctrl+D", when: "editorFocus", scope: "editor" }],
        unbound: []
      })
    });

    await service.initialize(makeExtensions());

    const editorRoot = document.createElement("div");
    editorRoot.setAttribute("data-context", "editor");
    const input = document.createElement("textarea");
    editorRoot.appendChild(input);
    document.body.appendChild(editorRoot);
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true });
    input.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.files.save");

    document.body.removeChild(editorRoot);
    service.dispose();
  });

  it("treats editorTextFocus as editorFocus with context chain", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const chain = createContextChain();
    chain.register({
      id: "editor-instance",
      priority: 40,
      context: { editorTextFocus: true, editorFocus: false, inputFocus: true }
    });
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Ctrl+Alt+K", when: "editorFocus", scope: "editor" }],
        unbound: []
      }),
      contextChain: chain
    });

    await service.initialize(makeExtensions());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, altKey: true, bubbles: true }));

    expect(executeCommand).toHaveBeenCalledWith("core.files.save");
    service.dispose();
  });
});
