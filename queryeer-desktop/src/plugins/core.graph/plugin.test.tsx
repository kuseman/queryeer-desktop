import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputContext, OutputContributor } from "../../contracts/extensions/OutputExtension";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { GRAPH_DOCUMENT_EDITOR_ID, GRAPH_DOCUMENT_EXTENSION, GRAPH_DOCUMENT_MIME_TYPE } from "./constants";

const outputRegistryMock = vi.hoisted(() => ({
  register: vi.fn()
}));

vi.mock("../core.queryengine/output/OutputRegistry", () => ({
  getOutputRegistry: () => outputRegistryMock
}));

vi.mock("./GraphViewer", () => ({
  GraphViewer: ({ graph }: { graph: { id: string } }) => <div data-testid="mock-graph-viewer">{graph.id}</div>
}));

import { coreGraphPlugin, handleGraphDocumentAction } from "./plugin";

void React;

const baseOutputContext: OutputContext = {
  state: "completed",
  resultSets: [],
  output: [],
  features: ["rows", "plan"],
  artifacts: [],
  metrics: null,
  error: null,
  progress: null,
  fetchedRowCount: 0,
  executionStartedAtMs: null,
  textOutputFormat: "plain",
  rowsTargetPrimaryId: null,
  fileId: "file-1"
};

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
    outputRegistryMock.register.mockClear();
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
    expect(outputRegistryMock.register).toHaveBeenCalledWith(expect.objectContaining({ capability: "plan" }));

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

  it("shows a compact selector for multiple plan artifacts", async () => {
    const context = makePluginContext();
    await coreGraphPlugin.activate(context);

    const contributor = outputRegistryMock.register.mock.calls
      .map((call) => call[0] as OutputContributor)
      .find((candidate) => candidate.id === "core.graph.queryPlanOutput");
    expect(contributor).toBeDefined();

    await act(async () => {
      root.render(<>{contributor!.render({
        ...baseOutputContext,
        artifacts: [
          {
            id: "plan-1",
            capability: "plan",
            kind: "graph",
            title: "Actual Query Plan",
            graph: { id: "graph-1", vertices: [{ id: "a", label: "A" }], edges: [] }
          },
          {
            id: "plan-2",
            capability: "plan",
            kind: "graph",
            title: "Actual Query Plan",
            graph: { id: "graph-2", vertices: [{ id: "b", label: "B" }], edges: [] }
          }
        ]
      })}</>);
    });

    expect(rootElement.textContent).toContain("Plans");
    expect(rootElement.textContent).toContain("Statement 1");
    expect(rootElement.textContent).toContain("graph-1");

    await act(async () => {
      (rootElement.querySelectorAll(".graph-plan-list-item")[1] as HTMLButtonElement).click();
    });

    expect(rootElement.textContent).toContain("graph-2");
  });
});
