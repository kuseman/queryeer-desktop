import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import {
  corePluginsPlugin,
  PLUGIN_MANAGER_EDITOR_ID,
  PLUGIN_MANAGER_MIME_TYPE,
  PLUGIN_MANAGER_URI,
  PluginManagerEditor
} from "./plugin";

void React;

function makePluginContext(): PluginContext {
  const commands = new Map<string, () => Promise<void> | void>();
  return {
    layout: { registerEditor: vi.fn() },
    commands: {
      registerCommand: vi.fn((command: { id: string; handler: () => Promise<void> | void }) => {
        commands.set(command.id, command.handler);
      })
    },
    menu: { registerMenuItem: vi.fn() },
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        registerContentCategory: vi.fn(),
        registerLabel: vi.fn()
      }
    },
    fileMediator: {
      openFile: vi.fn(async () => ({
        fileId: "plugins",
        version: 0,
        uri: PLUGIN_MANAGER_URI,
        mimeType: PLUGIN_MANAGER_MIME_TYPE,
        dirtyVsBackend: false,
        dirtyVsDisk: false,
        diskState: "inSync" as const,
        openedAt: new Date(0).toISOString()
      }))
    },
    _commands: commands
  } as unknown as PluginContext;
}

describe("core.plugins plugin", () => {
  const originalAppShell = window.appShell;
  let rootElement: HTMLDivElement;
  let root: Root;
  let getPluginInventory: ReturnType<typeof vi.fn>;
  let setPluginEnabled: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
    getPluginInventory = vi.fn(async () => ({
      pluginsDir: "C:/Users/example/AppData/Roaming/queryeer-desktop/plugins",
      lockfilePath: "C:/Users/example/AppData/Roaming/queryeer-desktop/settings/plugins-lock.json",
      safeMode: false,
      plugins: [
        {
          id: "external.one",
          name: "External One",
          version: "1.0.0",
          enabled: true,
          sourcePath: "C:/Users/example/AppData/Roaming/queryeer-desktop/plugins/external-one",
          sourceType: "folder" as const,
          status: "available" as const,
          hasFrontend: true,
          hasBackend: true,
          restartRequired: false
        }
      ]
    }));
    setPluginEnabled = vi.fn(async () => ({ accepted: true, restartRequired: true }));
    Object.defineProperty(window, "appShell", {
      configurable: true,
      value: { getPluginInventory, setPluginEnabled }
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
    Object.defineProperty(window, "appShell", {
      configurable: true,
      value: originalAppShell
    });
    vi.clearAllMocks();
  });

  it("registers a managed external plugin editor and command", async () => {
    const context = makePluginContext();
    const commands = (context as unknown as { _commands: Map<string, () => Promise<void> | void> })._commands;

    await corePluginsPlugin.activate(context);

    expect(context.layout.registerEditor).toHaveBeenCalledWith(expect.objectContaining({
      id: PLUGIN_MANAGER_EDITOR_ID,
      supportedMimeTypes: [PLUGIN_MANAGER_MIME_TYPE]
    }));
    expect(context.menu.registerMenuItem).toHaveBeenCalledWith(expect.objectContaining({
      id: "core.menu.tools.plugins",
      commandId: "core.plugins.open"
    }));

    await commands.get("core.plugins.open")?.();

    expect(context.fileMediator.openFile).toHaveBeenCalledWith(PLUGIN_MANAGER_URI, {
      mimeType: PLUGIN_MANAGER_MIME_TYPE,
      editorId: PLUGIN_MANAGER_EDITOR_ID
    });
  });

  it("renders external inventory and toggles restart-based enablement", async () => {
    await act(async () => {
      root.render(<PluginManagerEditor />);
      await Promise.resolve();
    });

    expect(rootElement.textContent).toContain("External One");
    expect(rootElement.textContent).toContain("Built-in plugins are always active");

    const disableButton = Array.from(rootElement.querySelectorAll("button")).find((button) => button.textContent === "Disable");
    expect(disableButton).toBeDefined();

    await act(async () => {
      disableButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setPluginEnabled).toHaveBeenCalledWith({ pluginId: "external.one", enabled: false });
  });
});
