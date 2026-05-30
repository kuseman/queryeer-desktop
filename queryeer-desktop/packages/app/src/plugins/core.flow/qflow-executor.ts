import { getExpressionRuntime } from "../core.expressions/runtime";
import type {
  FlowDocument,
  FlowExecutionResult,
  FlowNode,
  FlowNodeExecution,
  FlowNodeExecutionStatus,
  FlowRunMode
} from "./types";
import type { FlowNodeRunRequest, FlowNodeRunResult, FlowNodeRunner } from "@queryeer/api/flow/FlowNodeRunner.js";
import { getFlowNodeTypeContribution } from "./flow-node-type-contributions";

const MOCK_FAILURE_TOKEN = "flow.fail";

type ExecuteFlowOptions = {
  fileId?: string;
  previousExecution?: FlowExecutionResult;
  nodeRunner?: FlowNodeRunner;
  onProgress?: (execution: FlowExecutionResult) => void;
};

export function createMockFlowNodeRunner(): FlowNodeRunner {
  return runMockNodeAction;
}

export async function executeFlowDocument(
  document: FlowDocument,
  mode: FlowRunMode,
  options?: ExecuteFlowOptions
): Promise<FlowExecutionResult> {
  const nodesToRun = selectNodesForMode(document.nodes, mode);
  const selectedIds = new Set(nodesToRun.map((node) => node.metadata.id));
  const nodeRunner = options?.nodeRunner ?? createContributionFlowNodeRunner({
    fallbackRunner: createMockFlowNodeRunner()
  });

  const previousExecutionsByNodeId = new Map(
    (options?.previousExecution?.nodes ?? []).map((entry) => [entry.nodeId, entry])
  );
  const ctx: Record<string, unknown> = {
    ...(options?.previousExecution?.ctx ?? {})
  };
  const executions = new Map<string, FlowNodeExecution>();

  for (const node of document.nodes) {
    const previousExecution = previousExecutionsByNodeId.get(node.metadata.id);
    if (selectedIds.has(node.metadata.id)) {
      executions.set(node.metadata.id, createExecution(node, "pending"));
      continue;
    }

    if (previousExecution) {
      executions.set(node.metadata.id, cloneExecution(previousExecution));
      continue;
    }

    executions.set(node.metadata.id, createExecution(node, "pending"));
  }

  let failedNodeId: string | undefined;
  let stoppedOnFailure = false;

  for (const node of nodesToRun) {
    const execution = executions.get(node.metadata.id);
    if (!execution) {
      continue;
    }

    delete ctx[node.metadata.id];

    if (failedNodeId) {
      setExecutionStatus(execution, "skipped", {
        skipReason: "blockedByFailure"
      });
      continue;
    }

    const shouldRun = await evaluateRunIf(node, ctx);
    if (!shouldRun.ok) {
      setExecutionStatus(execution, "failed", {
        error: {
          code: "RUN_IF_EVALUATION_ERROR",
          message: shouldRun.message
        }
      });
      failedNodeId = node.metadata.id;
      stoppedOnFailure = true;
      continue;
    }
    if (!shouldRun.value) {
      setExecutionStatus(execution, "skipped", {
        skipReason: "runIfFalse"
      });
      continue;
    }

    setExecutionStatus(execution, "running");
    options?.onProgress?.(createExecutionResultSnapshot({
      document,
      mode,
      executions,
      ctx,
      failedNodeId,
      stoppedOnFailure
    }));
    const result = await runNodeAction(node, ctx, nodeRunner, options?.fileId);
    if (!result.ok) {
      setExecutionStatus(execution, "failed", {
        error: {
          code: result.code ?? "NODE_EXECUTION_FAILED",
          message: result.message,
          ...(result.details ? { details: result.details } : {})
        }
      });
      failedNodeId = node.metadata.id;
      stoppedOnFailure = true;
      continue;
    }

    execution.output = result.output;
    ctx[node.metadata.id] = {
      status: "completed",
      nodeType: node.metadata.type,
      output: result.output
    };
    setExecutionStatus(execution, "completed");
  }

  const orderedExecutions = document.nodes.map((node) => {
    const existing = executions.get(node.metadata.id);
    return existing ?? createExecution(node, "skipped");
  });

  return {
    mode,
    targetNodeId: mode.kind === "all" ? undefined : mode.nodeId,
    nodes: orderedExecutions,
    ctx,
    failedNodeId,
    stoppedOnFailure
  };
}

function createExecutionResultSnapshot(params: {
  document: FlowDocument;
  mode: FlowRunMode;
  executions: Map<string, FlowNodeExecution>;
  ctx: Record<string, unknown>;
  failedNodeId?: string;
  stoppedOnFailure: boolean;
}): FlowExecutionResult {
  return {
    mode: params.mode,
    targetNodeId: params.mode.kind === "all" ? undefined : params.mode.nodeId,
    nodes: params.document.nodes.map((node) => {
      const existing = params.executions.get(node.metadata.id);
      return existing ? cloneExecution(existing) : createExecution(node, "skipped");
    }),
    ctx: { ...params.ctx },
    failedNodeId: params.failedNodeId,
    stoppedOnFailure: params.stoppedOnFailure
  };
}

function selectNodesForMode(nodes: FlowNode[], mode: FlowRunMode): FlowNode[] {
  if (mode.kind === "all") {
    return nodes;
  }

  if (mode.kind === "node-only") {
    const target = nodes.find((node) => node.metadata.id === mode.nodeId);
    return target ? [target] : [];
  }

  if (mode.kind === "from-node") {
    const targetIndex = nodes.findIndex((node) => node.metadata.id === mode.nodeId);
    if (targetIndex < 0) {
      return [];
    }
    return nodes.slice(targetIndex);
  }

  const targetIndex = nodes.findIndex((node) => node.metadata.id === mode.nodeId);
  if (targetIndex < 0) {
    return [];
  }
  return nodes.slice(0, targetIndex + 1);
}

function createExecution(node: FlowNode, status: FlowNodeExecutionStatus): FlowNodeExecution {
  return {
    nodeId: node.metadata.id,
    nodeType: node.metadata.type,
    status
  };
}

function cloneExecution(execution: FlowNodeExecution): FlowNodeExecution {
  return {
    ...execution,
    ...(execution.error
      ? {
          error: {
            ...execution.error
          }
        }
      : {}),
    ...(execution.output
      ? {
          output: {
            ...execution.output,
            ...(execution.output.rows
              ? {
                  rows: execution.output.rows.map((row) => ({ ...row }))
                }
              : {})
          }
        }
      : {})
  };
}

function setExecutionStatus(
  execution: FlowNodeExecution,
  status: FlowNodeExecutionStatus,
  options?: {
    skipReason?: FlowNodeExecution["skipReason"];
    error?: FlowNodeExecution["error"];
  }
): void {
  execution.status = status;
  if (status === "running") {
    execution.startedAtMs = Date.now();
    execution.endedAtMs = undefined;
    execution.skipReason = undefined;
    execution.error = undefined;
    return;
  }

  if (execution.startedAtMs === undefined) {
    execution.startedAtMs = Date.now();
  }
  execution.endedAtMs = Date.now();
  execution.skipReason = options?.skipReason;
  execution.error = options?.error;
}

async function evaluateRunIf(
  node: FlowNode,
  ctx: Record<string, unknown>
): Promise<{ ok: true; value: boolean } | { ok: false; message: string }> {
  const expression = node.metadata.runIf?.trim();
  if (!expression) {
    return { ok: true, value: true };
  }

  try {
    const runtime = getExpressionRuntime();
    const value = await runtime.evaluateBoolean(expression, { ctx }, {
      mode: "when",
      source: "core.flow.runIf",
      timeoutMs: 50
    });
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function runNodeAction(
  node: FlowNode,
  ctx: Record<string, unknown>,
  nodeRunner: FlowNodeRunner,
  fileId?: string
): Promise<FlowNodeRunResult> {
  const action = node.action.trim();

  let renderedAction = action;
  try {
    renderedAction = await getExpressionRuntime().renderTemplate(action, { ctx }, {
      source: `core.flow.action.${node.metadata.id}`
    });
  } catch (error) {
    return {
      ok: false,
      message: `Node '${node.metadata.id}' action template failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  return nodeRunner({
    fileId,
    node,
    action: renderedAction,
    ctx
  });
}

export function createContributionFlowNodeRunner(options?: {
  fallbackRunner?: FlowNodeRunner;
}): FlowNodeRunner {
  return async (request) => {
    const contribution = getFlowNodeTypeContribution(request.node.metadata.type);
    if (contribution) {
      return contribution.execute(request);
    }
    if (options?.fallbackRunner) {
      return options.fallbackRunner(request);
    }
    return {
      ok: false,
      code: "FLOW_NODE_TYPE_UNSUPPORTED",
      message: `Flow node '${request.node.metadata.id}' has unsupported type '${request.node.metadata.type}'.`
    };
  };
}

async function runMockNodeAction(request: FlowNodeRunRequest): Promise<FlowNodeRunResult> {
  if (request.action.includes(MOCK_FAILURE_TOKEN)) {
    return {
      ok: false,
      message: `Node '${request.node.metadata.id}' failed due to mock failure token '${MOCK_FAILURE_TOKEN}'.`
    };
  }

  const preview = request.action.slice(0, 140);
  const rows = buildMockRows(request.node, request.ctx);
  return {
    ok: true,
    output: {
      rowsAffected: rows.length,
      rows,
      preview
    }
  };
}

function buildMockRows(node: FlowNode, ctx: Record<string, unknown>): Array<Record<string, unknown>> {
  const upstreamKeys = Object.keys(ctx);
  return [{
    nodeId: node.metadata.id,
    nodeType: node.metadata.type,
    upstreamCount: upstreamKeys.length,
    upstreamNodes: upstreamKeys.join(",")
  }];
}
