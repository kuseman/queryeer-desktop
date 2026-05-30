import { stringify } from "yaml";
import { parseQflowDocument } from "./qflow-parser";
import type { FlowNodeMetadata } from "./types";

const METADATA_START = "%%queryeer-flow";
const METADATA_END = "%%";

export function updateQflowNodeMetadataText(params: {
  source: string;
  nodeId: string;
  patch: Record<string, unknown>;
}): string {
  const normalized = params.source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const document = parseQflowDocument(normalized);
  const node = document.nodes.find((candidate) => candidate.metadata.id === params.nodeId);
  if (!node) {
    return params.source;
  }

  const metadataObject = applyMetadataPatch(toMetadataObject(node.metadata), params.patch);
  const replacement = [
    METADATA_START,
    ...toMetadataLines(metadataObject),
    METADATA_END
  ];

  const lines = normalized.split("\n");
  lines.splice(
    node.range.metadataStartLine - 1,
    node.range.metadataEndLine - node.range.metadataStartLine + 1,
    ...replacement
  );
  return lines.join("\n");
}

function toMetadataObject(metadata: FlowNodeMetadata): Record<string, unknown> {
  return {
    id: metadata.id,
    type: metadata.type,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.runIf ? { runIf: metadata.runIf } : {}),
    ...(metadata.additional ?? {})
  };
}

function applyMetadataPatch(
  current: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || (typeof value === "string" && value.trim().length === 0 && isOptionalKey(key))) {
      delete next[key];
      continue;
    }
    next[key] = typeof value === "string" ? value.trim() : value;
  }
  return next;
}

function isOptionalKey(key: string): boolean {
  return key === "description" || key === "runIf";
}

function toMetadataLines(metadataObject: Record<string, unknown>): string[] {
  return stringify(metadataObject, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE"
  }).replace(/\n$/g, "").split("\n");
}
