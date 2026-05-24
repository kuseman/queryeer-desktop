import type { FlowNode } from "./types";

export type FlowNodeFieldIssue = {
  field: "id" | "type" | "description" | "runIf";
  message: string;
};

export function validateFlowNodeCoreMetadata(node: FlowNode): FlowNodeFieldIssue[] {
  const issues: FlowNodeFieldIssue[] = [];

  if (!node.metadata.id.trim()) {
    issues.push({
      field: "id",
      message: "Node id is required."
    });
  }

  if (!node.metadata.type.trim()) {
    issues.push({
      field: "type",
      message: "Node type is required."
    });
  }

  return issues;
}
