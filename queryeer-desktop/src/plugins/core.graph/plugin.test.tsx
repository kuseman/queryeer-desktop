import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { GRAPH_DOCUMENT_EDITOR_ID, GRAPH_DOCUMENT_EXTENSION, GRAPH_DOCUMENT_MIME_TYPE } from "./constants";

vi.mock("./GraphViewer", () => ({
  GraphViewer: ({ graph }: { graph: { id: string } }) => <div data-testid="mock-graph-viewer">{graph.id}</div>
}));

import { coreGraphPlugin, handleGraphDocumentAction } from "./plugin";

void React;

function makePluginContext(): PluginContext {
  const commands = new Map<string, () => Promise<void> | void>();
  const createdFile = {
    fileId: "graph-file",
    version: 0,
    uri: "untitled:SampleGraph.qgraph",
    mimeType: GRAPH_DOCUMENT_MIME_TYPE,
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync" as const,
    openedAt: new Date().toISOString()
  };
  return {
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        registerContentCategory: vi.fn(),
        registerLabel: vi.fn()
      },
      registerMimeResolver: vi.fn(),
      mimeIcons: { registerMimeIcon: vi.fn() },
      updateFile: vi.fn()
    },
    layout: { registerEditor: vi.fn() },
    commands: {
      registerCommand: vi.fn((command: { id: string; handler: () => Promise<void> | void }) => {
        commands.set(command.id, command.handler);
      })
    },
    menu: { registerMenuItem: vi.fn() },
    assistant: {
      registerContextContribution: vi.fn(() => () => {}),
      registerToolContribution: vi.fn(() => () => {}),
      collectContext: vi.fn(async () => []),
      listTools: vi.fn(() => []),
      invokeTool: vi.fn(async () => ({ ok: false }))
    },
    fileMediator: {
      createUntitledFile: vi.fn(async () => createdFile)
    },
    _commands: commands
  } as unknown as PluginContext;
}

describe("core.graph plugin", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("handles the built-in copy id graph document action", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });

    await handleGraphDocumentAction({
      graphId: "graph",
      entityType: "vertex",
      entityId: "select",
      actionId: "copy-id"
    });

    expect(writeText).toHaveBeenCalledWith("select");
  });

  it("registers graph MIME editor and opens a sample graph", async () => {
    const context = makePluginContext();
    const commands = (context as unknown as { _commands: Map<string, () => Promise<void> | void> })._commands;

    await coreGraphPlugin.activate(context);

    expect(context.files.capabilities.registerCapabilities).toHaveBeenCalledWith(
      GRAPH_DOCUMENT_MIME_TYPE,
      ["viewable"]
    );
    expect(context.layout.registerEditor).toHaveBeenCalledWith(expect.objectContaining({
      id: GRAPH_DOCUMENT_EDITOR_ID,
      supportedMimeTypes: [GRAPH_DOCUMENT_MIME_TYPE]
    }));

    await commands.get("core.graph.openSample")?.();

    expect(context.fileMediator.createUntitledFile).toHaveBeenCalledWith({
      mimeType: GRAPH_DOCUMENT_MIME_TYPE,
      extension: GRAPH_DOCUMENT_EXTENSION,
      title: "SampleGraph"
    });
    expect(context.files.updateFile).toHaveBeenCalledWith(
      "graph-file",
      expect.objectContaining({
        metadata: expect.objectContaining({
          graphDocument: expect.objectContaining({ id: "core.graph.sample" }),
          workspaceTransient: true
        })
      })
    );
  });
});
