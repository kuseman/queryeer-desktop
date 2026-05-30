import type { ReactNode } from "react";
import type { FlowNodeRunRequest, FlowNodeRunResult } from "./FlowNodeRunner.js";
import type { FlowNode } from "./FlowDocument.js";

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
