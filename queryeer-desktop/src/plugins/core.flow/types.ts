export type FlowDiagnosticSeverity = "error" | "warning";

export type FlowDiagnostic = {
  severity: FlowDiagnosticSeverity;
  message: string;
  line: number;
  column: number;
};

export type FlowNodeType = string;

export type FlowNodeMetadata = {
  id: string;
  type: FlowNodeType;
  description?: string;
  runIf?: string;
  additional?: Record<string, unknown>;
};

export type FlowNodeSourceRange = {
  metadataStartLine: number;
  metadataEndLine: number;
  actionStartLine: number;
  actionEndLine: number;
};

export type FlowNode = {
  index: number;
  metadata: FlowNodeMetadata;
  action: string;
  range: FlowNodeSourceRange;
};

export type FlowDocument = {
  nodes: FlowNode[];
  diagnostics: FlowDiagnostic[];
};

export type FlowNodeExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type FlowNodeSkipReason = "runIfFalse" | "blockedByFailure";

export type FlowNodeExecution = {
  nodeId: string;
  nodeType: string;
  status: FlowNodeExecutionStatus;
  startedAtMs?: number;
  endedAtMs?: number;
  skipReason?: FlowNodeSkipReason;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  output?: {
    rowsAffected?: number;
    rows?: Array<Record<string, unknown>>;
    preview?: string;
  };
};

export type FlowRunMode =
  | { kind: "all" }
  | { kind: "to-node"; nodeId: string }
  | { kind: "node-only"; nodeId: string }
  | { kind: "from-node"; nodeId: string };

export type FlowExecutionResult = {
  mode: FlowRunMode;
  nodes: FlowNodeExecution[];
  ctx: Record<string, unknown>;
  targetNodeId?: string;
  failedNodeId?: string;
  stoppedOnFailure: boolean;
};
