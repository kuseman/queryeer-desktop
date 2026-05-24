import type { ReactNode } from "react";
import type { FlowNodeRunRequest, FlowNodeRunResult } from "./qflow-executor";
import type { FlowNode } from "./types";

export type FlowNodeTypeTemplate = {
  metadata: Record<string, unknown>;
  action?: string;
};

export type FlowNodeCodeLensItem = {
  title: string;
  commandId?: string;
  arguments?: unknown[];
};

export type FlowNodeSummaryItem = {
  label: string;
  value?: string;
  severity?: "info" | "warning" | "error";
};

export type FlowNodeConfigurationProps = {
  node: FlowNode;
  updateMetadata: (patch: Record<string, unknown>) => void;
};

export type FlowNodeConfigurationValidationResult = {
  field: string;
  message: string;
};

export type FlowNodeTypeContribution = {
  id: string;
  title: string;
  description?: string;
  createTemplate?: () => FlowNodeTypeTemplate;
  execute: (request: FlowNodeRunRequest) => Promise<FlowNodeRunResult>;
  getCodeLens?: (request: { node: FlowNode }) => FlowNodeCodeLensItem[];
  getSummary?: (request: { node: FlowNode }) => FlowNodeSummaryItem[];
  validateConfiguration?: (request: { node: FlowNode }) => FlowNodeConfigurationValidationResult[];
  renderConfiguration?: (props: FlowNodeConfigurationProps) => ReactNode;
};

const contributions = new Map<string, FlowNodeTypeContribution>();

export function registerFlowNodeTypeContribution(
  contribution: FlowNodeTypeContribution
): () => void {
  contributions.set(contribution.id, contribution);
  return () => {
    if (contributions.get(contribution.id) === contribution) {
      contributions.delete(contribution.id);
    }
  };
}

export function getFlowNodeTypeContribution(type: string): FlowNodeTypeContribution | undefined {
  return contributions.get(type);
}

export function listFlowNodeTypeContributions(): FlowNodeTypeContribution[] {
  return [...contributions.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function clearFlowNodeTypeContributionsForTests(): void {
  contributions.clear();
}
