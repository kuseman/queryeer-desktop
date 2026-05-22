import type {
  AssistantContextContribution,
  AssistantContextItem,
  AssistantToolContribution,
  AssistantToolInvocation,
  AssistantToolResult
} from "../../../contracts/assistant/Assistant";
import type { QueryOutputArtifact } from "../../../contracts/backend/Types";
import type { GraphDocument, GraphProperty, GraphPropertyGroup, GraphVertex } from "../../../contracts/graph";
import type { PluginContext } from "../../../contracts/plugin/Plugin";
import { getQueryEngineService } from "../QueryEngineService";
import { QUERY_PLAN_ARTIFACT_REQUEST, QUERY_PLAN_OUTPUT_ID } from "./constants";
import { getQueryPlanArtifactStore, type PlanGraphArtifact } from "./artifact-store";
import { getQueryPlanInteractionStore } from "./interaction-store";

type ArtifactTargetInput = {
  artifactId?: string;
};

type ListPlansInput = {
  allFiles?: boolean;
};

type SearchNodesInput = ArtifactTargetInput & {
  query: string;
  limit?: number;
};

type PlanSummaryInput = ArtifactTargetInput & {
  includeNodes?: boolean;
  nodeLimit?: number;
};

type HighlightNodesInput = ArtifactTargetInput & {
  nodeIds: string[];
  replace?: boolean;
  selectFirst?: boolean;
};

type EnsurePlanInput = Record<string, never>;

const QUERY_PLAN_ASSISTANT_WHEN = "hasActiveQueryExecutableFile && hasActiveQueryPlanDialect";

export function createQueryPlanAssistantTools(context: PluginContext): AssistantToolContribution[] {
  return [
    {
      id: "core.graph.queryPlan.list",
      title: "List Query Plan Graphs",
      description: "List query plan graph artifacts available to the assistant. By default this uses the active file; set allFiles=true to scan all open files.",
      order: 40,
      when: QUERY_PLAN_ASSISTANT_WHEN,
      inputSchema: {
        type: "object",
        properties: {
          allFiles: { type: "boolean" }
        }
      },
      invoke: (request) => listQueryPlans(context, request)
    },
    {
      id: "core.graph.queryPlan.get",
      title: "Get Query Plan Summary",
      description: "Get a concise summary of a query plan graph, including warnings and top-cost operators. Use artifactId to target a specific plan.",
      order: 41,
      when: QUERY_PLAN_ASSISTANT_WHEN,
      inputSchema: {
        type: "object",
        properties: {
          artifactId: { type: "string" },
          includeNodes: { type: "boolean" },
          nodeLimit: { type: "number" }
        }
      },
      invoke: (request) => getQueryPlanSummary(context, request)
    },
    {
      id: "core.graph.queryPlan.searchNodes",
      title: "Search Query Plan Nodes",
      description: "Search operators in a query plan graph by node id, label, kind, description, and property text.",
      order: 42,
      when: QUERY_PLAN_ASSISTANT_WHEN,
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          artifactId: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" }
        }
      },
      invoke: (request) => searchQueryPlanNodes(context, request)
    },
    {
      id: "core.graph.queryPlan.highlightNodes",
      title: "Highlight Query Plan Nodes",
      description: "Highlight one or more nodes in the active query plan viewer. Optionally select the first highlighted node.",
      order: 43,
      when: QUERY_PLAN_ASSISTANT_WHEN,
      inputSchema: {
        type: "object",
        required: ["nodeIds"],
        properties: {
          artifactId: { type: "string" },
          nodeIds: {
            type: "array",
            items: { type: "string" }
          },
          replace: { type: "boolean" },
          selectFirst: { type: "boolean" }
        }
      },
      getApproval: ({ input }) => {
        const parsed = parseHighlightNodesInput(input);
        if (!parsed.ok) {
          return {
            title: "Highlight query plan nodes",
            summary: parsed.message
          };
        }
        return {
          title: "Highlight query plan nodes",
          summary: `Highlight ${parsed.value.nodeIds.length} node${parsed.value.nodeIds.length === 1 ? "" : "s"} in the plan viewer`,
          details: [
            { label: "Node IDs", value: parsed.value.nodeIds.join(", ") },
            { label: "Replace", value: String(parsed.value.replace !== false) },
            { label: "Select first", value: String(parsed.value.selectFirst === true) }
          ]
        };
      },
      invoke: (request) => highlightQueryPlanNodes(context, request)
    },
    {
      id: "core.graph.queryPlan.clearHighlights",
      title: "Clear Query Plan Highlights",
      description: "Clear highlighted nodes in the active query plan graph.",
      order: 44,
      when: QUERY_PLAN_ASSISTANT_WHEN,
      inputSchema: {
        type: "object",
        properties: {
          artifactId: { type: "string" }
        }
      },
      invoke: (request) => clearQueryPlanHighlights(context, request)
    },
    {
      id: "core.graph.queryPlan.ensureEstimated",
      title: "Request Estimated Query Plan",
      description: "Request an estimated query plan execution for the active query file and route output to the plan viewer.",
      order: 45,
      when: QUERY_PLAN_ASSISTANT_WHEN,
      inputSchema: {
        type: "object",
        properties: {}
      },
      getApproval: ({ input }) => {
        const parsed = parseEnsurePlanInput(input);
        if (!parsed.ok) {
          return {
            title: "Request estimated plan",
            summary: parsed.message
          };
        }
        return {
          title: "Request estimated query plan",
          summary: "Start a new estimated-plan execution for the active query file"
        };
      },
      invoke: (request) => ensureEstimatedQueryPlan(context, request)
    }
  ];
}

export function createQueryPlanAssistantContextContributions(_context: PluginContext): AssistantContextContribution[] {
  return [
    {
      id: "core.graph.queryPlan.active",
      title: "Active Query Plan",
      order: 60,
      when: QUERY_PLAN_ASSISTANT_WHEN,
      collect: (request) => collectActivePlanContext(request)
    }
  ];
}

function collectActivePlanContext(request: { activeFileId: string | null }): AssistantContextItem[] {
  if (!request.activeFileId) {
    return [];
  }
  const artifact = getQueryPlanArtifactStore().latest(request.activeFileId);
  if (!artifact) {
    return [];
  }
  const interaction = getQueryPlanInteractionStore().get(artifact.graph.id);
  const summary = buildGraphSummary(artifact.graph, interaction.highlightedVertexIds.length);
  const payload = {
    fileId: request.activeFileId,
    artifactId: artifact.id,
    title: artifact.title,
    graphId: artifact.graph.id,
    summary
  };
  const text = JSON.stringify(payload);
  return [
    {
      id: `core.graph.queryPlan.active:${request.activeFileId}:${artifact.id}`,
      label: "Active Query Plan",
      kind: "query-plan",
      value: payload,
      metadata: { textLength: text.length }
    }
  ];
}

function listQueryPlans(context: PluginContext, request: AssistantToolInvocation): AssistantToolResult {
  const parsed = parseListPlansInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const fileIds = parsed.value.allFiles
    ? context.files.listFiles().map((file) => file.fileId)
    : request.activeFileId
      ? [request.activeFileId]
      : [];
  if (fileIds.length === 0) {
    return { ok: false, message: "No target file available. Activate a query file first." };
  }
  const store = getQueryPlanArtifactStore();
  const files = fileIds
    .map((fileId) => ({
      fileId,
      artifacts: store.list(fileId)
    }))
    .filter((entry) => entry.artifacts.length > 0)
    .map((entry) => ({
      fileId: entry.fileId,
      artifactCount: entry.artifacts.length,
      latestArtifactId: entry.artifacts[entry.artifacts.length - 1]?.id,
      artifacts: entry.artifacts.map((artifact) => ({
        id: artifact.id,
        title: artifact.title,
        graphId: artifact.graph.id,
        nodeCount: artifact.graph.vertices.length,
        edgeCount: artifact.graph.edges.length
      }))
    }));
  const totalArtifacts = files.reduce((sum, entry) => sum + entry.artifactCount, 0);
  if (totalArtifacts === 0) {
    return {
      ok: true,
      message: "No query plan artifacts are available yet. Run estimated or actual plan execution first.",
      data: {
        files: [],
        totalArtifacts: 0
      }
    };
  }
  return {
    ok: true,
    message: `Found ${totalArtifacts} query plan artifact${totalArtifacts === 1 ? "" : "s"}.`,
    data: {
      files,
      totalArtifacts
    }
  };
}

function getQueryPlanSummary(context: PluginContext, request: AssistantToolInvocation): AssistantToolResult {
  const parsed = parsePlanSummaryInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const resolved = resolvePlanArtifact(context, request, parsed.value);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const interaction = getQueryPlanInteractionStore().get(resolved.value.artifact.graph.id);
  const summary = buildGraphSummary(resolved.value.artifact.graph, interaction.highlightedVertexIds.length);
  const data: Record<string, unknown> = {
    fileId: resolved.value.fileId,
    artifactId: resolved.value.artifact.id,
    title: resolved.value.artifact.title,
    graphId: resolved.value.artifact.graph.id,
    summary,
    highlightedNodeIds: interaction.highlightedVertexIds,
    selectedEntity: interaction.selection
  };
  if (parsed.value.includeNodes === true) {
    const limit = parsed.value.nodeLimit ?? 80;
    const nodes = resolved.value.artifact.graph.vertices.slice(0, limit).map((vertex) => summarizeNode(vertex));
    data.nodes = nodes;
    data.nodesTruncated = resolved.value.artifact.graph.vertices.length > nodes.length;
    data.totalNodeCount = resolved.value.artifact.graph.vertices.length;
  }
  return {
    ok: true,
    message: `Loaded query plan ${resolved.value.artifact.id}.`,
    data
  };
}

function searchQueryPlanNodes(context: PluginContext, request: AssistantToolInvocation): AssistantToolResult {
  const parsed = parseSearchNodesInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const resolved = resolvePlanArtifact(context, request, parsed.value);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const allMatches = resolved.value.artifact.graph.vertices
    .map((vertex) => scoreVertexMatch(vertex, parsed.value.query))
    .filter((match): match is NodeSearchMatch => match !== null)
    .sort((left, right) => {
      const score = right.score - left.score;
      if (score !== 0) {
        return score;
      }
      return left.label.localeCompare(right.label);
    });
  const limit = parsed.value.limit ?? 30;
  const matches = allMatches.slice(0, limit);
  return {
    ok: true,
    message: matches.length === 0
      ? "No query plan nodes matched the search."
      : `Found ${allMatches.length} matching node${allMatches.length === 1 ? "" : "s"}.`,
    data: {
      fileId: resolved.value.fileId,
      artifactId: resolved.value.artifact.id,
      graphId: resolved.value.artifact.graph.id,
      query: parsed.value.query,
      matches,
      truncated: allMatches.length > matches.length,
      total: allMatches.length
    }
  };
}

function highlightQueryPlanNodes(context: PluginContext, request: AssistantToolInvocation): AssistantToolResult {
  const parsed = parseHighlightNodesInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const resolved = resolvePlanArtifact(context, request, parsed.value);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const nodeIds = new Set(resolved.value.artifact.graph.vertices.map((vertex) => vertex.id));
  const existingNodeIds = parsed.value.nodeIds.filter((nodeId) => nodeIds.has(nodeId));
  const missingNodeIds = parsed.value.nodeIds.filter((nodeId) => !nodeIds.has(nodeId));
  if (existingNodeIds.length === 0) {
    return {
      ok: false,
      message: "None of the provided node ids exist in the selected query plan.",
      data: {
        missingNodeIds
      }
    };
  }
  const store = getQueryPlanInteractionStore();
  store.setHighlightedVertices(resolved.value.artifact.graph.id, existingNodeIds, {
    replace: parsed.value.replace !== false
  });
  if (parsed.value.selectFirst === true) {
    store.select(resolved.value.artifact.graph.id, {
      type: "vertex",
      entityId: existingNodeIds[0]!
    });
  }
  const nextState = store.get(resolved.value.artifact.graph.id);
  return {
    ok: true,
    message: `Highlighted ${existingNodeIds.length} node${existingNodeIds.length === 1 ? "" : "s"}.`,
    data: {
      fileId: resolved.value.fileId,
      artifactId: resolved.value.artifact.id,
      graphId: resolved.value.artifact.graph.id,
      highlightedNodeIds: nextState.highlightedVertexIds,
      missingNodeIds,
      selection: nextState.selection
    }
  };
}

function clearQueryPlanHighlights(context: PluginContext, request: AssistantToolInvocation): AssistantToolResult {
  const parsed = parseArtifactTargetInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const resolved = resolvePlanArtifact(context, request, parsed.value);
  if (!resolved.ok) {
    return { ok: false, message: resolved.message };
  }
  const store = getQueryPlanInteractionStore();
  store.clearHighlights(resolved.value.artifact.graph.id);
  return {
    ok: true,
    message: "Cleared query plan highlights.",
    data: {
      fileId: resolved.value.fileId,
      artifactId: resolved.value.artifact.id,
      graphId: resolved.value.artifact.graph.id
    }
  };
}

function ensureEstimatedQueryPlan(context: PluginContext, request: AssistantToolInvocation): AssistantToolResult {
  const parsed = parseEnsurePlanInput(request.input);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message };
  }
  const activeFileId = request.activeFileId;
  if (!activeFileId) {
    return { ok: false, message: "No active query file. Activate a query file before requesting an estimated plan." };
  }

  const file = context.files.getFile(activeFileId);
  if (!file || !file.engineBinding?.engineId) {
    return { ok: false, message: "The active file is not bound to a query engine." };
  }
  getQueryEngineService().requestExecute({
    outputIdOverride: QUERY_PLAN_OUTPUT_ID,
    optionsOverride: {
      intent: "plan.estimated",
      requestedArtifacts: QUERY_PLAN_ARTIFACT_REQUEST
    }
  });
  return {
    ok: true,
    message: "Requested estimated query plan execution for the active file.",
    data: {
      fileId: activeFileId,
      intent: "plan.estimated",
      requestedArtifacts: QUERY_PLAN_ARTIFACT_REQUEST
    }
  };
}

function resolvePlanArtifact(
  context: PluginContext,
  request: AssistantToolInvocation,
  target: ArtifactTargetInput
): { ok: true; value: { fileId: string; artifact: PlanGraphArtifact } } | { ok: false; message: string } {
  const store = getQueryPlanArtifactStore();
  const fileId = request.activeFileId || "";
  const artifactId = target.artifactId?.trim() || "";

  if (artifactId && fileId) {
    const artifact = store.get(fileId, artifactId);
    if (!artifact) {
      for (const file of context.files.listFiles()) {
        const fallback = store.get(file.fileId, artifactId);
        if (fallback) {
          return { ok: true, value: { fileId: file.fileId, artifact: fallback } };
        }
      }
      return { ok: false, message: `No query plan artifact '${artifactId}' found for active or open files.` };
    }
    return { ok: true, value: { fileId, artifact } };
  }

  if (artifactId) {
    for (const file of context.files.listFiles()) {
      const artifact = store.get(file.fileId, artifactId);
      if (artifact) {
        return { ok: true, value: { fileId: file.fileId, artifact } };
      }
    }
    return { ok: false, message: `No query plan artifact '${artifactId}' is available in open files.` };
  }

  if (!fileId) {
    return { ok: false, message: "No target file available. Activate a query file first." };
  }

  const latest = store.latest(fileId);
  if (!latest) {
    return { ok: false, message: "No query plan artifacts are available for the target file." };
  }
  return { ok: true, value: { fileId, artifact: latest } };
}

function buildGraphSummary(graph: GraphDocument, highlightedNodeCount: number): Record<string, unknown> {
  const warningNodeCount = graph.vertices.filter((vertex) => hasOverlay(vertex, "warning")).length;
  const parallelNodeCount = graph.vertices.filter((vertex) => hasOverlay(vertex, "parallel")).length;
  const topCostNodes = graph.vertices
    .map((vertex) => ({
      id: vertex.id,
      label: vertex.label,
      kind: vertex.kind,
      estimatedCostPercent: findNumericProperty(vertex.properties, "estimatedCostPercent")
    }))
    .filter((entry) => entry.estimatedCostPercent !== null)
    .sort((left, right) => (right.estimatedCostPercent ?? 0) - (left.estimatedCostPercent ?? 0))
    .slice(0, 5)
    .map((entry) => ({
      id: entry.id,
      label: entry.label,
      kind: entry.kind,
      estimatedCostPercent: entry.estimatedCostPercent
    }));

  return {
    graphId: graph.id,
    title: graph.title,
    nodeCount: graph.vertices.length,
    edgeCount: graph.edges.length,
    warningNodeCount,
    parallelNodeCount,
    highlightedNodeCount,
    topCostNodes
  };
}

function summarizeNode(vertex: GraphVertex): Record<string, unknown> {
  return {
    id: vertex.id,
    label: vertex.label,
    kind: vertex.kind,
    description: vertex.description,
    importantProperties: flattenImportantProperties(vertex.properties).slice(0, 8)
  };
}

type NodeSearchMatch = {
  id: string;
  label: string;
  kind?: string;
  description?: string;
  matchedFields: string[];
  score: number;
};

function scoreVertexMatch(vertex: GraphVertex, query: string): NodeSearchMatch | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }
  const matchedFields: string[] = [];
  let score = 0;

  score += scoreText("id", vertex.id, normalizedQuery, matchedFields, 5);
  score += scoreText("label", vertex.label, normalizedQuery, matchedFields, 8);
  score += scoreText("kind", vertex.kind, normalizedQuery, matchedFields, 3);
  score += scoreText("description", vertex.description, normalizedQuery, matchedFields, 2);

  for (const group of vertex.properties ?? []) {
    score += scoreText(`propertyGroup:${group.label}`, group.label, normalizedQuery, matchedFields, 1);
    for (const property of group.properties) {
      score += scoreText(`property:${property.label}`, property.label, normalizedQuery, matchedFields, 3);
      score += scoreText(`propertyValue:${property.label}`, String(property.value ?? ""), normalizedQuery, matchedFields, 2);
    }
  }

  if (score <= 0) {
    return null;
  }

  return {
    id: vertex.id,
    label: vertex.label,
    kind: vertex.kind,
    description: vertex.description,
    matchedFields: Array.from(new Set(matchedFields)).slice(0, 8),
    score
  };
}

function scoreText(
  field: string,
  value: string | undefined,
  query: string,
  matchedFields: string[],
  weight: number
): number {
  const text = (value ?? "").trim();
  if (!text) {
    return 0;
  }
  const normalized = text.toLowerCase();
  if (!normalized.includes(query)) {
    return 0;
  }
  matchedFields.push(field);
  return normalized === query ? weight + 2 : weight;
}

function flattenImportantProperties(groups: GraphPropertyGroup[] | undefined): Array<{ id: string; label: string; value: unknown; unit?: string }> {
  const result: Array<{ id: string; label: string; value: unknown; unit?: string }> = [];
  for (const group of groups ?? []) {
    for (const property of group.properties) {
      if (property.important !== true) {
        continue;
      }
      result.push({
        id: property.id,
        label: property.label,
        value: property.value,
        ...(property.unit ? { unit: property.unit } : {})
      });
    }
  }
  return result;
}

function findNumericProperty(groups: GraphPropertyGroup[] | undefined, propertyId: string): number | null {
  for (const group of groups ?? []) {
    for (const property of group.properties) {
      if (property.id !== propertyId) {
        continue;
      }
      const value = numericValue(property);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function numericValue(property: GraphProperty): number | null {
  if (typeof property.value === "number" && Number.isFinite(property.value)) {
    return property.value;
  }
  if (typeof property.value === "string") {
    const parsed = Number.parseFloat(property.value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function hasOverlay(vertex: GraphVertex, kind: string): boolean {
  return (vertex.overlays ?? []).some((overlay) => overlay.kind === kind);
}

function parseListPlansInput(input: unknown): { ok: true; value: ListPlansInput } | { ok: false; message: string } {
  const base = parseObjectInput(input);
  if (!base.ok) {
    return base;
  }
  if (base.value.fileId !== undefined) {
    return { ok: false, message: "fileId is not supported. Queryeer provides the active file context automatically." };
  }
  if (base.value.allFiles !== undefined && typeof base.value.allFiles !== "boolean") {
    return { ok: false, message: "allFiles must be a boolean when provided" };
  }
  return {
    ok: true,
    value: {
      ...(typeof base.value.allFiles === "boolean" ? { allFiles: base.value.allFiles } : {})
    }
  };
}

function parsePlanSummaryInput(input: unknown): { ok: true; value: PlanSummaryInput } | { ok: false; message: string } {
  const target = parseArtifactTargetInput(input);
  if (!target.ok) {
    return target;
  }
  if (target.value.includeNodes !== undefined && typeof target.value.includeNodes !== "boolean") {
    return { ok: false, message: "includeNodes must be a boolean when provided" };
  }
  if (target.value.nodeLimit !== undefined && !isPositiveInteger(target.value.nodeLimit)) {
    return { ok: false, message: "nodeLimit must be a positive integer when provided" };
  }
  return {
    ok: true,
    value: {
      ...target.value,
      ...(typeof target.value.includeNodes === "boolean" ? { includeNodes: target.value.includeNodes } : {}),
      ...(typeof target.value.nodeLimit === "number" ? { nodeLimit: Math.min(500, target.value.nodeLimit) } : {})
    }
  };
}

function parseSearchNodesInput(input: unknown): { ok: true; value: SearchNodesInput } | { ok: false; message: string } {
  const target = parseArtifactTargetInput(input);
  if (!target.ok) {
    return target;
  }
  if (typeof target.value.query !== "string" || target.value.query.trim().length === 0) {
    return { ok: false, message: "query is required and must be a non-empty string" };
  }
  if (target.value.limit !== undefined && !isPositiveInteger(target.value.limit)) {
    return { ok: false, message: "limit must be a positive integer when provided" };
  }
  return {
    ok: true,
    value: {
      ...target.value,
      query: target.value.query.trim(),
      ...(typeof target.value.limit === "number" ? { limit: Math.min(200, target.value.limit) } : {})
    }
  };
}

function parseHighlightNodesInput(input: unknown): { ok: true; value: HighlightNodesInput } | { ok: false; message: string } {
  const target = parseArtifactTargetInput(input);
  if (!target.ok) {
    return target;
  }
  if (!Array.isArray(target.value.nodeIds) || target.value.nodeIds.length === 0) {
    return { ok: false, message: "nodeIds is required and must contain at least one node id" };
  }
  const nodeIds = target.value.nodeIds
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (nodeIds.length === 0) {
    return { ok: false, message: "nodeIds must contain non-empty string values" };
  }
  if (target.value.replace !== undefined && typeof target.value.replace !== "boolean") {
    return { ok: false, message: "replace must be a boolean when provided" };
  }
  if (target.value.selectFirst !== undefined && typeof target.value.selectFirst !== "boolean") {
    return { ok: false, message: "selectFirst must be a boolean when provided" };
  }
  return {
    ok: true,
    value: {
      ...target.value,
      nodeIds,
      ...(typeof target.value.replace === "boolean" ? { replace: target.value.replace } : {}),
      ...(typeof target.value.selectFirst === "boolean" ? { selectFirst: target.value.selectFirst } : {})
    }
  };
}

function parseEnsurePlanInput(input: unknown): { ok: true; value: EnsurePlanInput } | { ok: false; message: string } {
  const parsed = parseObjectInput(input);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.fileId !== undefined) {
    return { ok: false, message: "fileId is not supported. Queryeer provides the active file context automatically." };
  }
  return {
    ok: true,
    value: {}
  };
}

function parseArtifactTargetInput(input: unknown): { ok: true; value: Record<string, unknown> & ArtifactTargetInput } | { ok: false; message: string } {
  const parsed = parseObjectInput(input);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.fileId !== undefined) {
    return { ok: false, message: "fileId is not supported. Queryeer provides the active file context automatically." };
  }
  if (parsed.value.artifactId !== undefined && typeof parsed.value.artifactId !== "string") {
    return { ok: false, message: "artifactId must be a string when provided" };
  }
  return { ok: true, value: parsed.value };
}

function parseObjectInput(input: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  if (input === undefined || input === null) {
    return { ok: true, value: {} };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "Tool input must be an object" };
  }
  return { ok: true, value: input as Record<string, unknown> };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value > 0;
}

export function queryPlanArtifactsInResult(artifacts: QueryOutputArtifact[]): PlanGraphArtifact[] {
  return artifacts.filter((artifact) => artifact.capability === "plan" && artifact.kind === "graph") as PlanGraphArtifact[];
}
