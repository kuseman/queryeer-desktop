import type { FlowNodeExecution } from "./types";

export type FlowInlineResultPresentation = {
  statusClass: "running" | "completed" | "failed" | "skipped" | "not-run";
  title: string;
  detail?: string;
  preview?: string;
  action?: {
    kind: "resolve-mapping";
    label: string;
  };
  heightInLines: number;
};

export type FlowInlineNodeMarker = {
  nodeId: string;
  lineNumber: number;
  statusClass: "pending" | "running" | "completed" | "failed" | "skipped";
  hoverMessage: string;
};

const ESTIMATED_WRAP_COLUMNS = 92;

export function toFlowInlineResultPresentation(
  execution: FlowNodeExecution | undefined
): FlowInlineResultPresentation | undefined {
  if (!execution) {
    return undefined;
  }

  if (execution.status === "pending") {
    return {
      statusClass: "not-run",
      title: "Not Run",
      detail: "Not part of the latest action.",
      heightInLines: 2
    };
  }

  if (execution.status === "running") {
    return {
      statusClass: "running",
      title: "Running",
      detail: "Node execution in progress...",
      heightInLines: 2
    };
  }

  if (execution.status === "failed") {
    const isRepairableMapping = execution.error?.code === "FLOW_MAPPING_MISSING"
      || execution.error?.code === "FLOW_MAPPING_INVALID";
    return {
      statusClass: "failed",
      title: "Failed",
      detail: execution.error?.message ?? "Node execution failed.",
      ...(isRepairableMapping
        ? {
            action: {
              kind: "resolve-mapping" as const,
              label: "Resolve mapping"
            }
          }
        : {}),
      heightInLines: estimateHeightInLines(execution.error?.message) + (isRepairableMapping ? 1 : 0)
    };
  }

  if (execution.status === "skipped") {
    const detail = execution.skipReason === "blockedByFailure"
      ? "Skipped because an earlier node failed."
      : execution.skipReason === "runIfFalse"
        ? "Skipped because runIf evaluated to false."
        : "Skipped.";

    return {
      statusClass: "skipped",
      title: "Skipped",
      detail,
      heightInLines: estimateHeightInLines(detail)
    };
  }

  const rowsAffected = execution.output?.rowsAffected;
  const detail = typeof rowsAffected === "number"
    ? `Completed (${rowsAffected} rows).`
    : "Completed.";

  return {
    statusClass: "completed",
    title: "Completed",
    detail,
    preview: execution.output?.preview,
    heightInLines: estimateHeightInLines(detail, execution.output?.preview)
  };
}

export function toFlowInlineNodeMarkers(params: {
  nodes: Array<{ metadata: { id: string; type: string }; range: { metadataStartLine: number } }>;
  executionNodes?: FlowNodeExecution[];
}): FlowInlineNodeMarker[] {
  const executionByNodeId = new Map((params.executionNodes ?? []).map((entry) => [entry.nodeId, entry]));

  return params.nodes.map((node) => {
    const execution = executionByNodeId.get(node.metadata.id);
    const statusClass = execution?.status ?? "pending";

    return {
      nodeId: node.metadata.id,
      lineNumber: node.range.metadataStartLine,
      statusClass,
      hoverMessage: `${node.metadata.id} (${node.metadata.type})`
    };
  });
}

function estimateHeightInLines(...parts: Array<string | undefined>): number {
  const lineCount = parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .reduce((count, part) => count + estimateWrappedLineCount(part), 0);

  if (lineCount <= 1) {
    return 3;
  }

  return Math.max(3, Math.min(12, lineCount + 1));
}

function estimateWrappedLineCount(text: string): number {
  return text
    .split(/\r?\n/)
    .reduce((count, line) => {
      const visualLineCount = Math.max(1, Math.ceil(line.length / ESTIMATED_WRAP_COLUMNS));
      return count + visualLineCount;
    }, 0);
}
