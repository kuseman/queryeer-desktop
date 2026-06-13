import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { GRAPH_DOCUMENT_EDITOR_ID, GRAPH_DOCUMENT_MIME_TYPE } from "./constants";

const editorRegistryHostMock = vi.hoisted(() => ({
  registerContentRepository: vi.fn(() => () => {})
}));

vi.mock("../../core/plugin-runtime/ExtensionRegistry", () => ({
  getEditorRegistryHost: () => editorRegistryHostMock
}));

vi.mock("./GraphViewer", () => ({
  GraphViewer: ({
    graph,
    initialPropertiesPanelCollapsed
  }: {
    graph: { id: string };
    initialPropertiesPanelCollapsed?: boolean;
  }) => (
    <div data-testid="mock-graph-viewer" data-collapsed={String(initialPropertiesPanelCollapsed === true)}>
      {graph.id}
    </div>
  )
}));

import { coreGraphPlugin, handleGraphDocumentAction } from "./plugin";
import { getGraphDocumentRepository } from "./GraphDocumentRepository";

void React;

function makePluginContext(): PluginContext {
  return {
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        registerContentCategory: vi.fn(),
        registerLabel: vi.fn()
      },
      registerMimeResolver: vi.fn(),
      mimeIcons: { registerMimeIcon: vi.fn() },
      updateFile: vi.fn(),
      markDirty: vi.fn()
    },
    layout: { registerEditor: vi.fn() },
    commands: {
      registerCommand: vi.fn()
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
      createUntitledFile: vi.fn()
    }
  } as unknown as PluginContext;
}

function makeFile(fileId: string, mimeType: string): FileEntity {
  return {
    fileId,
    version: 0,
    uri: `untitled:${fileId}.qgraph`,
    mimeType,
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString()
  };
}

describe("core.graph plugin", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    editorRegistryHostMock.registerContentRepository.mockClear();
    getGraphDocumentRepository().clearForTests();
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

  it("registers graph MIME editor and content repository", async () => {
    const context = makePluginContext();

    await coreGraphPlugin.activate(context);

    expect(context.files.capabilities.registerCapabilities).toHaveBeenCalledWith(
      GRAPH_DOCUMENT_MIME_TYPE,
      ["viewable", "backupable"]
    );
    expect(context.layout.registerEditor).toHaveBeenCalledWith(expect.objectContaining({
      id: GRAPH_DOCUMENT_EDITOR_ID,
      supportedMimeTypes: [GRAPH_DOCUMENT_MIME_TYPE]
    }));
    expect(editorRegistryHostMock.registerContentRepository).toHaveBeenCalledWith(getGraphDocumentRepository());
    expect(context.commands.registerCommand).not.toHaveBeenCalled();
    expect(context.menu.registerMenuItem).not.toHaveBeenCalled();
  });

  it("starts JDBC graph documents with the properties panel collapsed", async () => {
    const context = makePluginContext();

    await coreGraphPlugin.activate(context);

    const registeredEditor = (context.layout.registerEditor as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      render: (renderContext: { activeFile: FileEntity }) => JSX.Element;
    };
    const genericFile = makeFile("generic-graph", GRAPH_DOCUMENT_MIME_TYPE);
    const jdbcFile = makeFile("jdbc-graph", "application/vnd.queryeer.jdbc-schema-graph+json");
    getGraphDocumentRepository().seedFile(genericFile, { id: "generic", vertices: [], edges: [] });
    getGraphDocumentRepository().seedFile(jdbcFile, { id: "jdbc", vertices: [], edges: [] });

    await act(async () => {
      root.render(registeredEditor.render({ activeFile: genericFile }));
    });
    expect(rootElement.querySelector("[data-testid='mock-graph-viewer']")?.getAttribute("data-collapsed")).toBe("false");

    await act(async () => {
      root.render(registeredEditor.render({ activeFile: jdbcFile }));
    });
    expect(rootElement.querySelector("[data-testid='mock-graph-viewer']")?.getAttribute("data-collapsed")).toBe("true");
  });
});
