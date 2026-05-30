import { getExpressionRuntime } from "../core.expressions/runtime";
import type { FlowDocument, FlowNode } from "./types";

const ROOT_METADATA_KEYS = [
  "id",
  "type",
  "description",
  "runIf"
] as const;

const QUERY_ACTION_SUGGESTIONS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "GROUP BY",
  "ORDER BY",
  "LIMIT",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "WITH"
] as const;

type QflowCompletionItemKind = "keyword" | "function" | "variable" | "field" | "module" | "snippet" | "property";

type CtxPathIndexNode = {
  children: Set<string>;
  detail?: string;
};

type FunctionPathIndexNode = {
  children: Set<string>;
  isFunction?: boolean;
  detail?: string;
  documentation?: string;
};

type RunIfCompletionContext = {
  qualifier?: string;
};

export type QflowCompletionItem = {
  label: string;
  kind: QflowCompletionItemKind;
  insertText: string;
  detail?: string;
  documentation?: string;
  sortText?: string;
  insertAsSnippet?: boolean;
};

export type QflowCompletionContext =
  | {
      kind: "none";
    }
  | {
      kind: "metadata";
      node: FlowNode;
      key?: string;
      inValue: boolean;
      indent: number;
    }
  | {
      kind: "runIf";
      node: FlowNode;
    }
  | {
      kind: "action";
      node: FlowNode;
    };

export function resolveQflowCompletionContext(
  document: FlowDocument,
  lineNumber: number,
  column: number,
  lineContent: string
): QflowCompletionContext {
  if (lineNumber < 1 || column < 1) {
    return { kind: "none" };
  }

  const node = document.nodes.find((candidate) =>
    lineNumber >= candidate.range.metadataStartLine
    && lineNumber <= candidate.range.actionEndLine
  );
  if (!node) {
    return { kind: "none" };
  }

  const inMetadataBody = lineNumber > node.range.metadataStartLine
    && lineNumber < node.range.metadataEndLine;

  if (inMetadataBody) {
    const indent = countLeadingWhitespace(lineContent);
    const parsedMetadataLine = parseMetadataLine(lineContent);
    if (!parsedMetadataLine) {
      return {
        kind: "metadata",
        node,
        inValue: false,
        indent
      };
    }

    if (parsedMetadataLine.key === "runIf" && parsedMetadataLine.inValue(column)) {
      return {
        kind: "runIf",
        node
      };
    }

    return {
      kind: "metadata",
      node,
      key: parsedMetadataLine.key,
      inValue: parsedMetadataLine.inValue(column),
      indent: parsedMetadataLine.indent
    };
  }

  if (lineNumber >= node.range.actionStartLine && lineNumber <= node.range.actionEndLine) {
    return {
      kind: "action",
      node
    };
  }

  return { kind: "none" };
}

export function getQflowCompletionsAtPosition(
  document: FlowDocument,
  lineNumber: number,
  column: number,
  lineContent: string
): QflowCompletionItem[] {
  const context = resolveQflowCompletionContext(document, lineNumber, column, lineContent);

  if (context.kind === "runIf") {
    return createRunIfCompletions(
      document,
      resolveRunIfCompletionContext(lineContent, column),
      context.node.index
    );
  }

  return getQflowCompletionsForContext(document, context);
}

export function getQflowCompletionsForContext(
  document: FlowDocument,
  context: QflowCompletionContext
): QflowCompletionItem[] {
  switch (context.kind) {
    case "runIf":
      return createRunIfCompletions(document, {}, context.node.index);
    case "action":
      return createActionCompletions(context.node.metadata.type);
    case "metadata":
      return createMetadataCompletions(context);
    default:
      return [];
  }
}

function createRunIfCompletions(
  document: FlowDocument,
  context: RunIfCompletionContext,
  currentNodeIndex: number
): QflowCompletionItem[] {
  const visibleNodeIds = listNodeIdsBeforeIndex(document, currentNodeIndex);
  const ctxPathIndex = buildCtxPathIndex(visibleNodeIds);
  const functionPathIndex = buildFunctionPathIndex();

  if (context.qualifier) {
    const ctxChildren = createCtxQualifierCompletions(ctxPathIndex, context.qualifier);
    const functionChildren = createFunctionQualifierCompletions(functionPathIndex, context.qualifier);
    return [...functionChildren, ...ctxChildren];
  }

  const completions: QflowCompletionItem[] = [
    {
      label: "ctx",
      kind: "module",
      insertText: "ctx",
      detail: "Flow context root",
      sortText: "010_ctx"
    },
    {
      label: "true",
      kind: "keyword",
      insertText: "true",
      sortText: "015_true"
    },
    {
      label: "false",
      kind: "keyword",
      insertText: "false",
      sortText: "016_false"
    }
  ];

  for (const nodeId of visibleNodeIds) {
    completions.push({
      label: `ctx.${nodeId}`,
      kind: "field",
      insertText: `ctx.${nodeId}`,
      detail: "Node context",
      sortText: `020_ctx_${nodeId}`
    });
    completions.push({
      label: `ctx.${nodeId}.output.rowsAffected`,
      kind: "field",
      insertText: `ctx.${nodeId}.output.rowsAffected`,
      detail: "Rows affected",
      sortText: `021_ctx_rows_${nodeId}`
    });
  }

  const runtimeFunctions = getExpressionRuntime()
    .getFunctionRegistry()
    .listFunctions();

  for (const { fqName, meta } of runtimeFunctions) {
    completions.push({
      label: fqName,
      kind: "function",
      insertText: fqName,
      detail: meta?.signature ?? "Expression function",
      documentation: meta?.description,
      sortText: `030_fn_${fqName}`
    });
  }

  return completions;
}

function buildCtxPathIndex(nodeIds: string[]): Map<string, CtxPathIndexNode> {
  const index = new Map<string, CtxPathIndexNode>();

  const ensure = (path: string): CtxPathIndexNode => {
    const existing = index.get(path);
    if (existing) {
      return existing;
    }
    const created: CtxPathIndexNode = {
      children: new Set<string>()
    };
    index.set(path, created);
    return created;
  };

  const addPath = (path: string, detail: string): void => {
    const segments = path.split(".").filter((segment) => segment.length > 0);
    let currentPath = "";
    for (let indexPosition = 0; indexPosition < segments.length; indexPosition += 1) {
      const segment = segments[indexPosition] ?? "";
      const parent = ensure(currentPath);
      parent.children.add(segment);

      currentPath = currentPath ? `${currentPath}.${segment}` : segment;
      const node = ensure(currentPath);
      if (indexPosition === segments.length - 1) {
        node.detail = detail;
      }
    }
  };

  ensure("");
  addPath("ctx", "Flow context root");

  for (const nodeId of nodeIds) {
    addPath(`ctx.${nodeId}`, "Node context");
    addPath(`ctx.${nodeId}.status`, "Node status");
    addPath(`ctx.${nodeId}.nodeType`, "Node type");
    addPath(`ctx.${nodeId}.output`, "Node output");
    addPath(`ctx.${nodeId}.output.rowsAffected`, "Rows affected");
    addPath(`ctx.${nodeId}.output.rows`, "Rows payload");
    addPath(`ctx.${nodeId}.output.preview`, "Output preview");
  }

  return index;
}

function listNodeIdsBeforeIndex(document: FlowDocument, currentNodeIndex: number): string[] {
  return [...new Set(
    document.nodes
      .filter((node) => node.index < currentNodeIndex)
      .map((node) => node.metadata.id.trim())
      .filter((id) => id.length > 0)
  )]
    .sort((left, right) => left.localeCompare(right));
}

function buildFunctionPathIndex(): Map<string, FunctionPathIndexNode> {
  const functionPathIndex = new Map<string, FunctionPathIndexNode>();

  const ensure = (path: string): FunctionPathIndexNode => {
    const existing = functionPathIndex.get(path);
    if (existing) {
      return existing;
    }
    const created: FunctionPathIndexNode = {
      children: new Set<string>()
    };
    functionPathIndex.set(path, created);
    return created;
  };

  ensure("");

  for (const { fqName, meta } of getExpressionRuntime().getFunctionRegistry().listFunctions()) {
    const segments = fqName.split(".").filter((segment) => segment.length > 0);
    let currentPath = "";
    for (let indexPosition = 0; indexPosition < segments.length; indexPosition += 1) {
      const segment = segments[indexPosition] ?? "";
      ensure(currentPath).children.add(segment);

      currentPath = currentPath ? `${currentPath}.${segment}` : segment;
      const node = ensure(currentPath);
      if (indexPosition === segments.length - 1) {
        node.isFunction = true;
        node.detail = meta?.signature ?? "Expression function";
        node.documentation = meta?.description;
      }
    }
  }

  return functionPathIndex;
}

function createCtxQualifierCompletions(
  pathIndex: Map<string, CtxPathIndexNode>,
  qualifier: string
): QflowCompletionItem[] {
  const node = pathIndex.get(qualifier);
  if (!node) {
    return [];
  }

  return [...node.children]
    .sort((left, right) => left.localeCompare(right))
    .map((child, index) => {
      const childPath = `${qualifier}.${child}`;
      const childNode = pathIndex.get(childPath);
      const hasChildren = (childNode?.children.size ?? 0) > 0;
      return {
        label: child,
        kind: hasChildren ? "module" : "field",
        insertText: child,
        detail: childNode?.detail,
        sortText: `040_ctx_${String(index).padStart(2, "0")}_${child}`
      };
    });
}

function createFunctionQualifierCompletions(
  pathIndex: Map<string, FunctionPathIndexNode>,
  qualifier: string
): QflowCompletionItem[] {
  const node = pathIndex.get(qualifier);
  if (!node) {
    return [];
  }

  return [...node.children]
    .sort((left, right) => left.localeCompare(right))
    .map((child, index) => {
      const childPath = `${qualifier}.${child}`;
      const childNode = pathIndex.get(childPath);
      return {
        label: child,
        kind: childNode?.isFunction ? "function" : "module",
        insertText: child,
        detail: childNode?.detail,
        documentation: childNode?.documentation,
        sortText: `030_fn_child_${String(index).padStart(2, "0")}_${child}`
      };
    });
}

function resolveRunIfCompletionContext(
  lineContent: string,
  column: number
): RunIfCompletionContext {
  const parsedLine = parseMetadataLine(lineContent);
  if (!parsedLine || parsedLine.key !== "runIf") {
    return {};
  }

  const cursorIndex = Math.max(0, column - 1);
  const beforeCursor = lineContent.slice(0, cursorIndex);
  const colonIndex = beforeCursor.indexOf(":");
  if (colonIndex < 0) {
    return {};
  }

  const expressionBeforeCursor = beforeCursor.slice(colonIndex + 1).trimEnd();
  const qualifierMatch = /(?:^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_.]*)\.$/.exec(expressionBeforeCursor);

  return {
    qualifier: qualifierMatch?.[1]
  };
}

function createActionCompletions(nodeType: string): QflowCompletionItem[] {
  const normalizedNodeType = nodeType.trim().toLowerCase();
  if (normalizedNodeType === "query"
    || normalizedNodeType === "sql"
    || normalizedNodeType === "jdbc.query"
    || normalizedNodeType === "payloadbuilder.query") {
    return [
      ...QUERY_ACTION_SUGGESTIONS.map((keyword, index) => ({
        label: keyword,
        kind: "keyword" as const,
        insertText: keyword,
        sortText: `010_sql_${String(index).padStart(2, "0")}_${keyword}`
      })),
      {
        label: "flow.fail",
        kind: "property",
        insertText: "flow.fail",
        detail: "Mock failure token",
        sortText: "090_flow_fail"
      }
    ];
  }

  if (normalizedNodeType === "script") {
    return [
      {
        label: "echo",
        kind: "snippet",
        insertText: "echo \"${1:message}\"",
        detail: "Script snippet",
        sortText: "010_script_echo",
        insertAsSnippet: true
      },
      {
        label: "flow.fail",
        kind: "property",
        insertText: "flow.fail",
        detail: "Mock failure token",
        sortText: "090_flow_fail"
      }
    ];
  }

  return [
    {
      label: "flow.fail",
      kind: "property",
      insertText: "flow.fail",
      detail: "Mock failure token"
    }
  ];
}

function createMetadataCompletions(context: Extract<QflowCompletionContext, { kind: "metadata" }>): QflowCompletionItem[] {
  if (!context.inValue) {
    return ROOT_METADATA_KEYS.map((key, index) => ({
      label: key,
      kind: "property",
      insertText: `${key}: `,
      sortText: `010_meta_${String(index).padStart(2, "0")}_${key}`
    }));
  }

  if (context.key === "type" && context.indent === 0) {
    return [
      {
        label: "jdbc.query",
        kind: "keyword",
        insertText: "jdbc.query",
        sortText: "010_type_jdbc_query"
      },
      {
        label: "payloadbuilder.query",
        kind: "keyword",
        insertText: "payloadbuilder.query",
        sortText: "011_type_payloadbuilder_query"
      }
    ];
  }

  return [];
}

function parseMetadataLine(lineContent: string): {
  key: string;
  indent: number;
  inValue: (column: number) => boolean;
} | undefined {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*:(.*)$/.exec(lineContent);
  if (!match) {
    return undefined;
  }

  const key = match[1] ?? "";
  const colonIndex = lineContent.indexOf(":");
  const indent = countLeadingWhitespace(lineContent);
  return {
    key,
    indent,
    inValue: (column: number) => {
      const columnIndex = Math.max(0, column - 1);
      return columnIndex > colonIndex;
    }
  };
}

function countLeadingWhitespace(value: string): number {
  return /^\s*/.exec(value)?.[0]?.length ?? 0;
}
