import type {
  FlowDiagnostic,
  FlowDocument,
  FlowNode,
  FlowNodeMetadata
} from "./types";
import { LineCounter, YAMLParseError, YAMLWarning, parseDocument, stringify } from "yaml";

const METADATA_START = "%%queryeer-flow";
const METADATA_END = "%%";

export function parseQflowDocument(source: string): FlowDocument {
  const normalized = normalizeLineEndings(source);
  const lines = normalized.split("\n");
  const nodes: FlowNode[] = [];
  const diagnostics: FlowDiagnostic[] = [];
  const declaredNodeIdLines = new Map<string, number>();

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? "";
    if (!line.trimStart().startsWith(METADATA_START)) {
      lineIndex += 1;
      continue;
    }

    const metadataStartIndex = lineIndex;
    const metadataEndIndex = findMetadataEnd(lines, metadataStartIndex + 1);
    if (metadataEndIndex < 0) {
      diagnostics.push({
        severity: "error",
        message: "Unclosed flow metadata block. Expected '%%'.",
        line: metadataStartIndex + 1,
        column: 1
      });
      break;
    }

    const metadataLines = lines.slice(metadataStartIndex + 1, metadataEndIndex);
    const metadataIdLine = findMetadataKeyLine(metadataLines, "id", metadataStartIndex + 2)
      ?? metadataStartIndex + 1;
    const metadata = parseNodeMetadata(metadataLines, metadataStartIndex + 2, diagnostics, nodes.length + 1);

    const firstDeclaredAtLine = declaredNodeIdLines.get(metadata.id);
    if (firstDeclaredAtLine !== undefined) {
      diagnostics.push({
        severity: "error",
        message: `Duplicate flow node id '${metadata.id}'. First declared at line ${firstDeclaredAtLine}.`,
        line: metadataIdLine,
        column: 1
      });
    } else {
      declaredNodeIdLines.set(metadata.id, metadataIdLine);
    }

    const nextMetadataStart = findNextMetadataStart(lines, metadataEndIndex + 1);
    const actionLineStartIndex = metadataEndIndex + 1;
    const actionLineEndExclusiveIndex = nextMetadataStart >= 0 ? nextMetadataStart : lines.length;
    const actionRaw = lines.slice(actionLineStartIndex, actionLineEndExclusiveIndex).join("\n");
    const action = trimTrailingBlankLines(actionRaw);
    const actionStartLine = actionLineStartIndex + 1;
    const actionEndLine = Math.max(actionStartLine, actionLineEndExclusiveIndex);

    if (action.trim().length === 0) {
      diagnostics.push({
        severity: "warning",
        message: `Flow node '${metadata.id}' has an empty action body.`,
        line: Math.min(lines.length, actionStartLine),
        column: 1
      });
    }

    nodes.push({
      index: nodes.length,
      metadata,
      action,
      range: {
        metadataStartLine: metadataStartIndex + 1,
        metadataEndLine: metadataEndIndex + 1,
        actionStartLine,
        actionEndLine
      }
    });

    lineIndex = actionLineEndExclusiveIndex;
  }

  return {
    nodes,
    diagnostics
  };
}

export function serializeQflowDocument(input: FlowDocument | FlowNode[]): string {
  const nodes = Array.isArray(input) ? input : input.nodes;
  if (nodes.length === 0) {
    return "";
  }

  const chunks: string[] = [];
  for (const node of nodes) {
    const metadataLines = toMetadataLines(node.metadata);
    const nodeLines = [METADATA_START, ...metadataLines, METADATA_END];
    if (node.action.trim().length > 0) {
      nodeLines.push(node.action);
    }
    chunks.push(nodeLines.join("\n"));
  }

  return chunks.join("\n\n");
}

export function resolveNodeIdForLine(document: FlowDocument, lineNumber: number): string | undefined {
  if (lineNumber < 1) {
    return undefined;
  }

  let fallbackNodeId: string | undefined;
  for (const node of document.nodes) {
    if (lineNumber >= node.range.metadataStartLine && lineNumber <= node.range.actionEndLine) {
      return node.metadata.id;
    }
    if (lineNumber > node.range.actionEndLine) {
      fallbackNodeId = node.metadata.id;
    }
  }
  return fallbackNodeId;
}

function normalizeLineEndings(source: string): string {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function findMetadataEnd(lines: string[], fromIndex: number): number {
  for (let i = fromIndex; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trim() === METADATA_END) {
      return i;
    }
  }
  return -1;
}

function findNextMetadataStart(lines: string[], fromIndex: number): number {
  for (let i = fromIndex; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trimStart().startsWith(METADATA_START)) {
      return i;
    }
  }
  return -1;
}

function findMetadataKeyLine(lines: string[], key: string, firstLineNumber: number): number | undefined {
  const keyPattern = new RegExp(`^\\s*${escapeRegExp(key)}\\s*:`);

  for (let index = 0; index < lines.length; index += 1) {
    if (keyPattern.test(lines[index] ?? "")) {
      return firstLineNumber + index;
    }
  }

  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNodeMetadata(
  lines: string[],
  firstLineNumber: number,
  diagnostics: FlowDiagnostic[],
  fallbackOrdinal: number
): FlowNodeMetadata {
  const metadataText = lines.join("\n");
  const parsedYaml = parseMetadataYaml(metadataText, firstLineNumber, diagnostics);

  const id = toRequiredString(parsedYaml.id, `flow-node-${fallbackOrdinal}`);
  if (!isNonEmptyString(parsedYaml.id)) {
    diagnostics.push({
      severity: "error",
      message: "Missing required metadata key 'id'.",
      line: firstLineNumber,
      column: 1
    });
  }

  const type = toRequiredString(parsedYaml.type, "query");
  if (!isNonEmptyString(parsedYaml.type)) {
    diagnostics.push({
      severity: "error",
      message: "Missing required metadata key 'type'.",
      line: firstLineNumber,
      column: 1
    });
  }

  const description = toOptionalString(parsedYaml.description);
  const runIf = toOptionalExpressionString(parsedYaml.runIf);

  const additional = collectAdditionalMetadata(parsedYaml, [
    "id",
    "type",
    "description",
    "runIf"
  ]);

  return {
    id,
    type,
    ...(description ? { description } : {}),
    ...(runIf ? { runIf } : {}),
    ...(Object.keys(additional).length > 0 ? { additional } : {})
  };
}

function toRequiredString(value: unknown, fallback: string): string {
  if (isNonEmptyString(value)) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function toOptionalString(value: unknown): string | undefined {
  if (isNonEmptyString(value)) {
    return value.trim();
  }
  return undefined;
}

function toOptionalExpressionString(value: unknown): string | undefined {
  if (isNonEmptyString(value)) {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function trimTrailingBlankLines(text: string): string {
  return text.replace(/\n+$/g, "");
}

function toMetadataLines(metadata: FlowNodeMetadata): string[] {
  const metadataObject: Record<string, unknown> = {
    id: metadata.id,
    type: metadata.type,
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.runIf ? { runIf: metadata.runIf } : {}),
    ...(metadata.additional ?? {})
  };

  const yamlText = stringify(metadataObject, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE"
  }).replace(/\n$/g, "");

  return yamlText.split("\n");
}

function parseMetadataYaml(
  metadataText: string,
  firstLineNumber: number,
  diagnostics: FlowDiagnostic[]
): Record<string, unknown> {
  const lineCounter = new LineCounter();
  const document = parseDocument(metadataText, {
    lineCounter,
    strict: false,
    uniqueKeys: true
  });

  for (const warning of document.warnings) {
    diagnostics.push(toYamlDiagnostic("warning", warning, firstLineNumber));
  }
  for (const error of document.errors) {
    diagnostics.push(toYamlDiagnostic("error", error, firstLineNumber));
  }

  const value = document.toJS();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push({
      severity: "error",
      message: "Flow metadata must be a YAML object.",
      line: firstLineNumber,
      column: 1
    });
    return {};
  }

  return value as Record<string, unknown>;
}

function toYamlDiagnostic(
  severity: FlowDiagnostic["severity"],
  error: YAMLParseError | YAMLWarning,
  firstLineNumber: number
): FlowDiagnostic {
  const position = error.linePos?.[0];
  if (!position) {
    return {
      severity,
      message: error.message,
      line: firstLineNumber,
      column: 1
    };
  }

  return {
    severity,
    message: error.message,
    line: firstLineNumber + Math.max(0, position.line - 1),
    column: Math.max(1, position.col)
  };
}

function collectAdditionalMetadata(
  metadata: Record<string, unknown>,
  knownKeys: string[]
): Record<string, unknown> {
  const known = new Set(knownKeys);
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !known.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}
