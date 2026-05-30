import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantContextItem, AssistantToolContribution, AssistantToolInvocation, AssistantToolResult } from "@queryeer/api/assistant/Assistant";
import type { QueryOutputArtifact } from "@queryeer/api/backend/Types";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { GraphDocument } from "@queryeer/api/graph";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { getQueryPlanArtifactStore } from "./artifact-store";
import { getQueryPlanInteractionStore } from "./interaction-store";
import {
  createQueryPlanAssistantContextContributions,
  createQueryPlanAssistantTools,
  queryPlanArtifactsInResult
} from "./assistant-tools";

const mocks = vi.hoisted(() => ({
  requestExecute: vi.fn()
}));

vi.mock("../QueryEngineService", () => ({
  getQueryEngineService: () => ({
    requestExecute: mocks.requestExecute
  })
}));

function createFile(fileId: string, engineId?: string): FileEntity {
  return {
    fileId,
    version: 1,
    uri: `file:///tmp/${fileId}.sql`,
    mimeType: "application/sql",
    ...(engineId ? { engineBinding: { engineId } } : {}),
    metadata: {
      "core.queryengine.jdbc.dialectId": "sqlserver",
      "core.queryengine.jdbc.supportsQueryPlan": true
    },
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString()
  };
}

function createContext(files: FileEntity[]): PluginContext {
  const filesById = new Map(files.map((file) => [file.fileId, file]));
  return {
    files: {
      getFile: vi.fn((fileId: string) => filesById.get(fileId)),
      listFiles: vi.fn(() => [...filesById.values()])
    }
  } as unknown as PluginContext;
}

function createGraph(graphId: string): GraphDocument {
  return {
    id: graphId,
    title: "Estimated Plan",
    vertices: [
      {
        id: "node-1",
        label: "Clustered Index Scan",
        kind: "scan",
        overlays: [{ id: "ov-warning", kind: "warning", label: "Warning" }],
        properties: [{
          id: "costs",
          label: "Costs",
          properties: [{ id: "estimatedCostPercent", label: "Estimated cost", value: 78, important: true }]
        }]
      },
      {
        id: "node-2",
        label: "Nested Loops",
        kind: "join",
        overlays: [{ id: "ov-parallel", kind: "parallel", label: "Parallel" }],
        properties: [{
          id: "details",
          label: "Details",
          properties: [{ id: "predicate", label: "Predicate", value: "CustomerId = Id", important: true }]
        }]
      }
    ],
    edges: [{ id: "edge-1", sourceVertexId: "node-1", targetVertexId: "node-2" }]
  };
}

function createArtifact(id: string, capability: string, graphId: string): QueryOutputArtifact {
  return {
    id,
    capability,
    kind: "graph",
    title: `${capability}-${id}`,
    graph: createGraph(graphId)
  };
}

async function invokeTool(
  tools: AssistantToolContribution[],
  toolId: string,
  input: unknown,
  activeFileId: string | null
): Promise<AssistantToolResult> {
  const tool = tools.find((candidate) => candidate.id === toolId);
  expect(tool).toBeDefined();
  const invocation: AssistantToolInvocation = {
    toolId,
    input,
    activeFileId,
    contextValues: {}
  };
  return Promise.resolve(tool!.invoke(invocation));
}

describe("query plan assistant tools", () => {
  beforeEach(() => {
    getQueryPlanArtifactStore().clear();
    getQueryPlanInteractionStore().clear();
    mocks.requestExecute.mockReset();
  });

  it("lists plan artifacts for active file or all files", async () => {
    const context = createContext([createFile("file-1", "jdbc"), createFile("file-2", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);
    const store = getQueryPlanArtifactStore();
    store.rememberArtifacts("file-1", [
      createArtifact("rows-1", "rows", "rows-graph"),
      createArtifact("plan-1", "plan", "graph-1"),
      createArtifact("plan-2", "plan", "graph-2")
    ]);
    store.rememberArtifacts("file-2", [createArtifact("plan-3", "plan", "graph-3")]);

    const activeOnly = await invokeTool(tools, "core.graph.queryPlan.list", {}, "file-1");
    expect(activeOnly.ok).toBe(true);
    expect(activeOnly.data).toEqual(expect.objectContaining({
      totalArtifacts: 2,
      files: [expect.objectContaining({ fileId: "file-1", artifactCount: 2, latestArtifactId: "plan-2" })]
    }));

    const allFiles = await invokeTool(tools, "core.graph.queryPlan.list", { allFiles: true }, "file-1");
    expect(allFiles.ok).toBe(true);
    expect(allFiles.data).toEqual(expect.objectContaining({ totalArtifacts: 3 }));
    expect((allFiles.data as { files: Array<{ fileId: string }> }).files.map((file) => file.fileId)).toEqual(["file-1", "file-2"]);
  });

  it("returns a summary with highlight and node details", async () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);
    getQueryPlanArtifactStore().rememberArtifacts("file-1", [createArtifact("plan-1", "plan", "graph-1")]);
    getQueryPlanInteractionStore().setHighlightedVertices("graph-1", ["node-2"]);
    getQueryPlanInteractionStore().select("graph-1", { type: "vertex", entityId: "node-2" });

    const result = await invokeTool(tools, "core.graph.queryPlan.get", { includeNodes: true, nodeLimit: 1 }, "file-1");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      artifactId: "plan-1",
      graphId: "graph-1",
      highlightedNodeIds: ["node-2"],
      nodesTruncated: true,
      totalNodeCount: 2
    }));

    const summary = (result.data as { summary: Record<string, unknown> }).summary;
    expect(summary).toEqual(expect.objectContaining({
      warningNodeCount: 1,
      parallelNodeCount: 1,
      highlightedNodeCount: 1,
      nodeCount: 2,
      edgeCount: 1
    }));
  });

  it("searches nodes using labels and properties", async () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);
    getQueryPlanArtifactStore().rememberArtifacts("file-1", [createArtifact("plan-1", "plan", "graph-1")]);

    const result = await invokeTool(tools, "core.graph.queryPlan.searchNodes", { query: "customerid", limit: 5 }, "file-1");
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.objectContaining({
      total: 1,
      query: "customerid",
      matches: [expect.objectContaining({ id: "node-2" })]
    }));
  });

  it("highlights existing nodes and reports missing ids", async () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);
    getQueryPlanArtifactStore().rememberArtifacts("file-1", [createArtifact("plan-1", "plan", "graph-1")]);

    const first = await invokeTool(tools, "core.graph.queryPlan.highlightNodes", {
      nodeIds: ["node-1", "missing-node"],
      selectFirst: true
    }, "file-1");
    expect(first.ok).toBe(true);
    expect(first.data).toEqual(expect.objectContaining({
      highlightedNodeIds: ["node-1"],
      missingNodeIds: ["missing-node"],
      selection: { type: "vertex", entityId: "node-1" }
    }));

    const merged = await invokeTool(tools, "core.graph.queryPlan.highlightNodes", {
      nodeIds: ["node-2"],
      replace: false
    }, "file-1");
    expect(merged.ok).toBe(true);
    expect((merged.data as { highlightedNodeIds: string[] }).highlightedNodeIds).toEqual(["node-1", "node-2"]);
  });

  it("clears highlights for the selected plan", async () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);
    getQueryPlanArtifactStore().rememberArtifacts("file-1", [createArtifact("plan-1", "plan", "graph-1")]);
    getQueryPlanInteractionStore().setHighlightedVertices("graph-1", ["node-1", "node-2"]);

    const result = await invokeTool(tools, "core.graph.queryPlan.clearHighlights", {}, "file-1");
    expect(result.ok).toBe(true);
    expect(getQueryPlanInteractionStore().get("graph-1").highlightedVertexIds).toEqual([]);
  });

  it("requests estimated plans through query engine service", async () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);

    const result = await invokeTool(tools, "core.graph.queryPlan.ensureEstimated", {}, "file-1");
    expect(result.ok).toBe(true);
    expect(mocks.requestExecute).toHaveBeenCalledWith({
      outputIdOverride: "core.graph.queryPlanOutput",
      optionsOverride: {
        intent: "plan.estimated",
        requestedArtifacts: [{ capability: "plan", kind: "graph" }]
      }
    });
  });

  it("collects active plan context and filters plan artifacts helper", async () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const contributions = createQueryPlanAssistantContextContributions(context);
    expect(contributions).toHaveLength(1);

    const collect = contributions[0]!.collect;
    const empty = await Promise.resolve(collect({ activeFileId: "file-1", activeFile: undefined, contextValues: {} }));
    expect(empty).toEqual([]);

    getQueryPlanArtifactStore().rememberArtifacts("file-1", [createArtifact("plan-1", "plan", "graph-1")]);
    getQueryPlanInteractionStore().setHighlightedVertices("graph-1", ["node-1", "node-2"]);

    const items = await Promise.resolve(collect({ activeFileId: "file-1", activeFile: undefined, contextValues: {} }));
    expect(items).toHaveLength(1);
    const contextItem = items[0] as AssistantContextItem;
    expect(contextItem.kind).toBe("query-plan");
    expect(contextItem.value).toEqual(expect.objectContaining({
      fileId: "file-1",
      artifactId: "plan-1",
      summary: expect.objectContaining({ highlightedNodeCount: 2 })
    }));

    const filtered = queryPlanArtifactsInResult([
      createArtifact("rows-1", "rows", "rows-graph"),
      createArtifact("plan-2", "plan", "graph-2")
    ]);
    expect(filtered.map((artifact) => artifact.id)).toEqual(["plan-2"]);
  });

  it("only contributes tools/context when query-plan dialect context is true", () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);
    const contributions = createQueryPlanAssistantContextContributions(context);

    for (const tool of tools) {
      expect(tool.when).toBe("hasActiveQueryExecutableFile && hasActiveQueryPlanDialect");
    }
    for (const contribution of contributions) {
      expect(contribution.when).toBe("hasActiveQueryExecutableFile && hasActiveQueryPlanDialect");
    }
  });

  it("does not accept fileId input and relies on active file context", async () => {
    const context = createContext([createFile("file-1", "jdbc")]);
    const tools = createQueryPlanAssistantTools(context);
    getQueryPlanArtifactStore().rememberArtifacts("file-1", [createArtifact("plan-1", "plan", "graph-1")]);

    const listTool = tools.find((tool) => tool.id === "core.graph.queryPlan.list");
    const getTool = tools.find((tool) => tool.id === "core.graph.queryPlan.get");
    const ensureTool = tools.find((tool) => tool.id === "core.graph.queryPlan.ensureEstimated");

    const listProperties = (listTool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
    const getProperties = (getTool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};
    const ensureProperties = (ensureTool?.inputSchema as { properties?: Record<string, unknown> })?.properties ?? {};

    expect(listProperties).not.toHaveProperty("fileId");
    expect(getProperties).not.toHaveProperty("fileId");
    expect(ensureProperties).not.toHaveProperty("fileId");

    const listResult = await invokeTool(tools, "core.graph.queryPlan.list", { fileId: "file-2" }, "file-1");
    expect(listResult.ok).toBe(false);
    expect(listResult.message).toContain("fileId is not supported");

    const getResult = await invokeTool(tools, "core.graph.queryPlan.get", { fileId: "file-2" }, "file-1");
    expect(getResult.ok).toBe(false);
    expect(getResult.message).toContain("fileId is not supported");

    const ensureResult = await invokeTool(tools, "core.graph.queryPlan.ensureEstimated", { fileId: "file-2" }, "file-1");
    expect(ensureResult.ok).toBe(false);
    expect(ensureResult.message).toContain("fileId is not supported");
  });
});
