import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { GRAPH_DOCUMENT_EDITOR_ID, GRAPH_DOCUMENT_EXTENSION, GRAPH_DOCUMENT_MIME_TYPE } from "./constants";

const outputRegistryMock = vi.hoisted(() => ({
  register: vi.fn()
}));

vi.mock("../core.queryengine/output/OutputRegistry", () => ({
  getOutputRegistry: () => outputRegistryMock
}));

import { coreGraphPlugin, handleGraphDocumentAction } from "./plugin";

describe("core.graph plugin", () => {
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
    const context = {
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
      }
    } as unknown as PluginContext;

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
});
