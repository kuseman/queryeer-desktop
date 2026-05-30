import type { FlowNode } from "./FlowDocument.js";
import type { FlowNodeExecutionOutput } from "./FlowDocument.js";

export type FlowNodeRunRequest = {
  fileId?: string;
  node: FlowNode;
  action: string;
  ctx: Record<string, unknown>;
};

export type FlowNodeRunResult =
  | { ok: true; output: FlowNodeExecutionOutput }
  | { ok: false; message: string; code?: string; details?: Record<string, unknown> };

export type FlowNodeRunner = (request: FlowNodeRunRequest) => Promise<FlowNodeRunResult>;
