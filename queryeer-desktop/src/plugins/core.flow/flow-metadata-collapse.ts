import type { FlowDocument, FlowNode } from "./types";

export const FLOW_METADATA_COLLAPSE_STATE_KEY = "core.flow.metadataCollapse";

type TextRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type MetadataToggleDecoration = {
  lineNumber: number;
  glyphMarginClassName: string;
  hoverMessage: string;
};

export type MetadataCollapsePlan = {
  hiddenRanges: TextRange[];
  toggleDecorations: MetadataToggleDecoration[];
};

export type MetadataCollapsedLineDecoration = {
  lineNumber: number;
  lineClassName: string;
  hoverMessage: string;
};

type PersistedMetadataCollapseState = {
  expandedNodeIds?: unknown;
};

export function buildMetadataCollapsePlan(params: {
  document: FlowDocument;
  expandedNodeIds: ReadonlySet<string>;
}): MetadataCollapsePlan {
  return {
    hiddenRanges: params.document.nodes
      .filter((node) => shouldCollapseNode(params.document, node, params.expandedNodeIds))
      .map((node) => ({
        startLineNumber: node.range.metadataStartLine + 1,
        startColumn: 1,
        endLineNumber: node.range.metadataEndLine - 1,
        endColumn: Number.MAX_SAFE_INTEGER
      })),
    toggleDecorations: params.document.nodes.map((node) => ({
      lineNumber: node.range.metadataStartLine,
      glyphMarginClassName: params.expandedNodeIds.has(node.metadata.id)
        ? "flow-metadata-toggle flow-metadata-toggle-expanded"
        : "flow-metadata-toggle",
      hoverMessage: params.expandedNodeIds.has(node.metadata.id)
        ? "Hide flow node metadata"
        : "Show flow node metadata"
    }))
  };
}

export function buildMetadataCollapseFallbackDecorations(params: {
  document: FlowDocument;
  expandedNodeIds: ReadonlySet<string>;
  lineClassName: string;
}): MetadataCollapsedLineDecoration[] {
  const decorations: MetadataCollapsedLineDecoration[] = [];
  for (const node of params.document.nodes) {
    if (!shouldCollapseNode(params.document, node, params.expandedNodeIds)) {
      continue;
    }
    for (let lineNumber = node.range.metadataStartLine + 1; lineNumber < node.range.metadataEndLine; lineNumber += 1) {
      decorations.push({
        lineNumber,
        lineClassName: params.lineClassName,
        hoverMessage: "Metadata collapse is not supported by this editor build."
      });
    }
  }
  return decorations;
}

export function normalizeExpandedMetadataNodeIds(
  document: FlowDocument,
  expandedNodeIds: ReadonlySet<string>
): ReadonlySet<string> {
  const validNodeIds = new Set(document.nodes.map((node) => node.metadata.id));
  return new Set([...expandedNodeIds].filter((nodeId) => validNodeIds.has(nodeId)));
}

export function readPersistedExpandedMetadataNodeIds(state: unknown): ReadonlySet<string> {
  if (Array.isArray(state)) {
    return new Set(state.filter(isNonEmptyString).map((value) => value.trim()));
  }

  if (!state || typeof state !== "object") {
    return new Set();
  }

  const raw = (state as PersistedMetadataCollapseState).expandedNodeIds;
  if (!Array.isArray(raw)) {
    return new Set();
  }

  return new Set(raw.filter(isNonEmptyString).map((value) => value.trim()));
}

export function toPersistedExpandedMetadataNodeIds(
  expandedNodeIds: ReadonlySet<string>
): { expandedNodeIds: string[] } | undefined {
  const expanded = [...expandedNodeIds]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));

  if (expanded.length === 0) {
    return undefined;
  }

  return {
    expandedNodeIds: expanded
  };
}

function hasMetadataDiagnostic(document: FlowDocument, node: FlowNode): boolean {
  return document.diagnostics.some((diagnostic) =>
    diagnostic.line >= node.range.metadataStartLine
    && diagnostic.line <= node.range.metadataEndLine
  );
}

function shouldCollapseNode(
  document: FlowDocument,
  node: FlowNode,
  expandedNodeIds: ReadonlySet<string>
): boolean {
  return !expandedNodeIds.has(node.metadata.id)
    && !hasMetadataDiagnostic(document, node)
    && node.range.metadataEndLine > node.range.metadataStartLine + 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
