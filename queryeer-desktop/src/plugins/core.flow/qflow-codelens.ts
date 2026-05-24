import { getFlowNodeTypeContribution } from "./flow-node-type-contributions";
import type { FlowDocument, FlowExecutionResult, FlowNode } from "./types";

export type QflowCodeLensCommand = {
  id: string;
  title: string;
  arguments?: unknown[];
};

export type QflowCodeLens = {
  lineNumber: number;
  commands: QflowCodeLensCommand[];
};

export const FLOW_RUN_NODE_COMMAND_ID = "core.flow.runNodeAtCursor";
export const FLOW_RUN_TO_NODE_COMMAND_ID = "core.flow.runToNodeAtCursor";
export const FLOW_CONFIGURE_NODE_COMMAND_ID = "core.flow.configureNodeAtCursor";
export const FLOW_CODELENS_NOOP_COMMAND_ID = "core.flow.codeLensNoop";

export function getQflowCodeLens(params: {
  document: FlowDocument;
  execution?: FlowExecutionResult;
}): QflowCodeLens[] {
  const executionByNodeId = new Map(
    (params.execution?.nodes ?? []).map((entry) => [entry.nodeId, entry])
  );

  return params.document.nodes.map((node) => {
    const execution = executionByNodeId.get(node.metadata.id);
    return {
      lineNumber: Math.max(1, node.range.metadataStartLine),
      commands: [
        { id: FLOW_RUN_NODE_COMMAND_ID, title: "Run Node", arguments: [node.metadata.id] },
        { id: FLOW_RUN_TO_NODE_COMMAND_ID, title: "Run To Here", arguments: [node.metadata.id] },
        { id: FLOW_CONFIGURE_NODE_COMMAND_ID, title: "Configure", arguments: [node.metadata.id] },
        { id: FLOW_CODELENS_NOOP_COMMAND_ID, title: toStatusTitle(execution?.status) },
        ...getContributionCommands(node)
      ]
    };
  });
}

function getContributionCommands(node: FlowNode): QflowCodeLensCommand[] {
  const contribution = getFlowNodeTypeContribution(node.metadata.type);
  const summaries = contribution?.getSummary?.({ node }) ?? [];
  const summaryCommands = summaries.map((summary) => ({
    id: FLOW_CODELENS_NOOP_COMMAND_ID,
    title: summary.value ? `${summary.label}: ${summary.value}` : summary.label
  }));
  const codeLensCommands = contribution?.getCodeLens?.({ node }).map((item) => ({
    id: item.commandId ?? FLOW_CODELENS_NOOP_COMMAND_ID,
    title: item.title,
    arguments: item.arguments
  })) ?? [];
  return [...summaryCommands, ...codeLensCommands];
}

function toStatusTitle(status: string | undefined): string {
  switch (status) {
    case "running":
      return "🟡 Running";
    case "completed":
      return "🟢 Passed";
    case "failed":
      return "🔴 Failed";
    case "skipped":
      return "🟠 Skipped";
    default:
      return "⚪ Pending";
  }
}
