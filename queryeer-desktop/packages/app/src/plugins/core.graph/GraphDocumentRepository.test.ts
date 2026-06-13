import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { GraphDocument } from "@queryeer/api/graph";
import { getGraphDocumentRepository } from "./GraphDocumentRepository";

const graph: GraphDocument = {
  id: "graph-1",
  vertices: [{ id: "v1", label: "Vertex 1" }],
  edges: []
};

function createFile(fileId = "file-1", uri = "untitled:Graph.qgraph"): FileEntity {
  return {
    fileId,
    version: 0,
    uri,
    mimeType: "application/vnd.queryeer.graph+json",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString()
  };
}

describe("GraphDocumentRepository", () => {
  beforeEach(() => {
    getGraphDocumentRepository().clearForTests();
  });

  it("serializes seeded graph documents for file saves", () => {
    const repository = getGraphDocumentRepository();

    repository.seedFile(createFile(), graph);

    expect(repository.getModelForFile("file-1")?.getContent()).toContain("graph-1");
    expect(repository.getModelForUri("untitled:Graph.qgraph")?.getContent()).toContain("Vertex 1");
  });

  it("notifies dirty listeners when seeded as dirty", () => {
    const repository = getGraphDocumentRepository();
    const listener = vi.fn();
    repository.onContentDirty(listener);

    repository.seedFile(createFile(), graph, { notifyDirty: true });

    expect(listener).toHaveBeenCalledWith("file-1", expect.stringContaining("graph-1"));
  });

  it("restores graph documents from recovered backup content", () => {
    const repository = getGraphDocumentRepository();

    repository.applyRecoveredContent("file-1", JSON.stringify(graph));

    expect(repository.getModelForFile("file-1")?.getContent()).toContain("graph-1");
  });
});
