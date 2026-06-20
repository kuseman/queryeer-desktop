import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import { KEYBINDINGS_SCHEMA_VERSION, type UserKeybindingsDocument } from "@queryeer/api/commands/Keybindings";
import { createKeybindingService } from "./keybinding-service";
import { createContextChain } from "./context-chain";

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

  it("executes modified global keybinding via metaKey (macOS) when select input is focused", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Cmd+S", when: "global", scope: "global" }],
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

    const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true });
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
    editorRoot.className = "text-editor-component";
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

  it("does not execute editor scoped keybinding for an output target when editor context is stale", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.editor.text.find", executed: true }));
    const chain = createContextChain();
    chain.register({
      id: "editor-instance",
      priority: 40,
      context: { editorTextFocus: true, editorFocus: true, inputFocus: true }
    });
    const service = createKeybindingService({
      executeCommand,
      canExecuteCommand: () => true,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [],
        unbound: []
      }),
      contextChain: chain
    });

    const extensions = makeExtensions();
    extensions.commands.push({ id: "core.editor.text.find", title: "Find", handler: () => {} });
    extensions.keybindings.push({
      id: "core.editor.text.keybinding.find",
      commandId: "core.editor.text.find",
      key: "CmdOrCtrl+F",
      when: "editorFocus",
      scope: "editor",
      order: 30
    });

    await service.initialize(extensions);

    const outputRoot = document.createElement("div");
    outputRoot.className = "query-output-text-root";
    document.body.appendChild(outputRoot);

    const event = new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
    outputRoot.dispatchEvent(event);

    expect(executeCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(outputRoot);
    service.dispose();
  });

  it("executes editorFocus keybinding while a non-input editor container is focused", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Ctrl+S", when: "editorFocus", scope: "editor" }],
        unbound: []
      })
    });

    await service.initialize(makeExtensions());

    const editorRoot = document.createElement("div");
    editorRoot.className = "text-editor-component";
    editorRoot.tabIndex = -1;
    document.body.appendChild(editorRoot);
    editorRoot.focus();

    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true });
    editorRoot.dispatchEvent(event);

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

  it("uses the active editor scope when split panes register competing editor contexts", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const chain = createContextChain();
    chain.register({
      id: "left-editor",
      priority: 40,
      context: { editorTextFocus: true, editorFocus: false, inputFocus: true, languageId: "sql" }
    });
    chain.register({
      id: "right-editor",
      priority: 40,
      context: { editorTextFocus: false, editorFocus: false, inputFocus: false, languageId: "json" }
    });
    chain.activate("left-editor");
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Ctrl+Alt+K", when: "editorFocus && languageId == 'sql'", scope: "editor" }],
        unbound: []
      }),
      contextChain: chain
    });

    await service.initialize(makeExtensions());
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, altKey: true, bubbles: true }));

    expect(executeCommand).toHaveBeenCalledWith("core.files.save");
    service.dispose();
  });

  it("executes Escape user keybinding in editor context", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.queryengine.cancel", executed: true }));
    const chain = createContextChain();
    chain.register({
      id: "active-file",
      priority: 20,
      context: { hasActiveQueryExecutableFile: true }
    });
    chain.register({
      id: "editor-instance",
      priority: 40,
      context: { editorTextFocus: true, editorFocus: false, inputFocus: true }
    });
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.queryengine.cancel", key: "Escape", when: "hasActiveQueryExecutableFile", scope: "global" }],
        unbound: []
      }),
      contextChain: chain
    });

    const extensions = makeExtensions();
    extensions.commands.push({ id: "core.queryengine.cancel", title: "Cancel Query", handler: () => {} });

    await service.initialize(extensions);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.queryengine.cancel");
    expect(event.defaultPrevented).toBe(true);
    service.dispose();
  });

  it("does not consume Escape when the matching command is disabled", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.queryengine.cancel", executed: false, reason: "disabled-by-enablement" as const }));
    const chain = createContextChain();
    chain.register({
      id: "active-file",
      priority: 20,
      context: { hasActiveQueryExecutableFile: true }
    });
    chain.register({
      id: "editor-instance",
      priority: 40,
      context: { editorTextFocus: true, editorFocus: false, inputFocus: true }
    });
    const service = createKeybindingService({
      executeCommand,
      canExecuteCommand: (commandId) => commandId !== "core.queryengine.cancel",
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.queryengine.cancel", key: "Escape", when: "hasActiveQueryExecutableFile", scope: "global" }],
        unbound: []
      }),
      contextChain: chain
    });

    const extensions = makeExtensions();
    extensions.commands.push({ id: "core.queryengine.cancel", title: "Cancel Query", handler: () => {} });

    await service.initialize(extensions);
    const editorRoot = document.createElement("div");
    editorRoot.setAttribute("data-context", "editor");
    const input = document.createElement("textarea");
    editorRoot.appendChild(input);
    document.body.appendChild(editorRoot);
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(executeCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(editorRoot);
    service.dispose();
  });

  it("does not intercept Escape when Monaco has an open suggest widget", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.editor.text.closeFindWidget", executed: true }));
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
        bindings: [],
        unbound: []
      }),
      contextChain: chain
    });

    const extensions = makeExtensions();
    extensions.commands.push({ id: "core.editor.text.closeFindWidget", title: "Close Find", handler: () => {} });
    extensions.keybindings.push({
      id: "k.closeFindWidget",
      commandId: "core.editor.text.closeFindWidget",
      key: "Escape",
      when: "editorFocus",
      scope: "editor",
      order: 33
    });

    await service.initialize(extensions);

    // Simulate an open Monaco suggest widget in the DOM
    const editorRoot = document.createElement("div");
    editorRoot.className = "monaco-editor";
    const suggestWidget = document.createElement("div");
    suggestWidget.className = "suggest-widget visible";
    editorRoot.appendChild(suggestWidget);
    document.body.appendChild(editorRoot);

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(executeCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(editorRoot);
    service.dispose();
  });

  it("executes user Escape binding when inside editor DOM but Monaco declined", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.queryengine.cancel", executed: true }));
    const chain = createContextChain();
    chain.register({
      id: "active-file",
      priority: 20,
      context: { hasActiveQueryExecutableFile: true }
    });
    chain.register({
      id: "editor-instance",
      priority: 40,
      context: { editorTextFocus: true, editorFocus: false, inputFocus: true }
    });
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.queryengine.cancel", key: "Escape", when: "hasActiveQueryExecutableFile", scope: "global" }],
        unbound: []
      }),
      contextChain: chain
    });

    const extensions = makeExtensions();
    extensions.commands.push({ id: "core.queryengine.cancel", title: "Cancel Query", handler: () => {} });
    // Also register the default closeFindWidget binding
    extensions.commands.push({ id: "core.editor.text.closeFindWidget", title: "Close Find", handler: () => {} });
    extensions.keybindings.push({
      id: "k.closeFindWidget",
      commandId: "core.editor.text.closeFindWidget",
      key: "Escape",
      when: "editorFocus",
      scope: "editor",
      order: 33
    });

    await service.initialize(extensions);

    // Create editor DOM and focus inside it so isInEditor() returns true
    const editorRoot = document.createElement("div");
    editorRoot.setAttribute("data-context", "editor");
    const input = document.createElement("textarea");
    editorRoot.appendChild(input);
    document.body.appendChild(editorRoot);
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.queryengine.cancel");
    expect(event.defaultPrevented).toBe(true);

    document.body.removeChild(editorRoot);
    service.dispose();
  });

  it("executes Escape user keybinding when NOT inside editor DOM", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.queryengine.cancel", executed: true }));
    const chain = createContextChain();
    chain.register({
      id: "active-file",
      priority: 20,
      context: { hasActiveQueryExecutableFile: true }
    });
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.queryengine.cancel", key: "Escape", when: "hasActiveQueryExecutableFile", scope: "global" }],
        unbound: []
      }),
      contextChain: chain
    });

    const extensions = makeExtensions();
    extensions.commands.push({ id: "core.queryengine.cancel", title: "Cancel Query", handler: () => {} });

    await service.initialize(extensions);
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(event);

    expect(executeCommand).toHaveBeenCalledWith("core.queryengine.cancel");
    expect(event.defaultPrevented).toBe(true);
    service.dispose();
  });

  it("does not execute keybindings for Enter inside modal dialog", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.files.save", executed: true }));
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.files.save", key: "Enter", when: "global", scope: "global" }],
        unbound: []
      })
    });

    const extensions = makeExtensions();
    extensions.keybindings.push({
      id: "k.save.enter",
      commandId: "core.files.save",
      key: "Enter",
      when: "global",
      scope: "global",
      order: 20
    });

    await service.initialize(extensions);

    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const input = document.createElement("input");
    overlay.appendChild(input);
    document.body.appendChild(overlay);
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(executeCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(overlay);
    service.dispose();
  });

  it("does not execute Escape keybindings inside modal dialog", async () => {
    const executeCommand = vi.fn(async () => ({ commandId: "core.queryengine.cancel", executed: true }));
    const service = createKeybindingService({
      executeCommand,
      getUserKeybindings: async () => ({
        version: KEYBINDINGS_SCHEMA_VERSION,
        bindings: [{ commandId: "core.queryengine.cancel", key: "Escape", when: "global", scope: "global" }],
        unbound: []
      })
    });

    const extensions = makeExtensions();
    extensions.commands.push({ id: "core.queryengine.cancel", title: "Cancel Query", handler: () => {} });

    await service.initialize(extensions);

    const overlay = document.createElement("div");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    const input = document.createElement("input");
    overlay.appendChild(input);
    document.body.appendChild(overlay);
    input.focus();

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(executeCommand).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(overlay);
    service.dispose();
  });
});
