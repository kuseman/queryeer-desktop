import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { getFlowStateStore, useFlowStateSnapshot } from "./flow-state";
import { getFlowNodeTypeContribution } from "./flow-node-type-contributions";
import { flowTextRegistry } from "./FlowEditorComponent";
import { updateQflowNodeMetadataText } from "./qflow-metadata-edit";
import { parseQflowDocument } from "./qflow-parser";
import { WhenExpressionEditor } from "../core.commands/WhenExpressionEditor";
import type { CtxVar } from "../core.commands/when-expression-types";
import { validateFlowNodeCoreMetadata } from "./flow-metadata-validation";
import type { FlowDocument, FlowExecutionResult, FlowNode } from "./types";

type ActiveFileRef = {
  fileId: string;
};

export function FlowContextView(): JSX.Element {
  const [activeFile, setActiveFile] = useState<ActiveFileRef | null>(() => {
    const fileId = getEditorRegistryHost().getActiveEditor()?.fileId ?? null;
    return fileId ? { fileId } : null;
  });

  useEffect(() => {
    const subscription = getEditorRegistryHost().onActiveEditorChanged((editor) => {
      const fileId = editor?.fileId ?? null;
      setActiveFile(fileId ? { fileId } : null);
    });
    return () => {
      subscription.dispose();
    };
  }, []);

  const snapshot = useFlowStateSnapshot(activeFile?.fileId ?? null);
  const execution = snapshot.execution;
  const ctx = execution?.ctx ?? null;

  const updateActiveNodeMetadata = (nodeId: string, patch: Record<string, unknown>): void => {
    if (!activeFile) {
      return;
    }
    const editor = flowTextRegistry.getActiveEditor();
    const source = editor?.getContent() ?? flowTextRegistry.getModelForFile(activeFile.fileId)?.getContent();
    if (!editor || source === undefined) {
      return;
    }
    const next = updateQflowNodeMetadataText({ source, nodeId, patch });
    if (next === source) {
      return;
    }
    const endLine = editor.getLineCount();
    const endColumn = editor.getLineContent(endLine).length + 1;
    editor.applyEdits([{
      range: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: endLine,
        endColumn
      },
      newText: next
    }]);
    getFlowStateStore().setDocument(activeFile.fileId, parseQflowDocument(next));
    getFlowStateStore().setActiveNode(activeFile.fileId, patch.id && typeof patch.id === "string" ? patch.id : nodeId);
  };

  if (!activeFile) {
    return <div className="flow-context-empty">Open a .qflow file to inspect ctx.</div>;
  }

  if (!snapshot.document || snapshot.document.nodes.length === 0) {
    return <div className="flow-context-empty">No flow nodes found in this file.</div>;
  }

  const executionByNodeId = new Map((execution?.nodes ?? []).map((entry) => [entry.nodeId, entry]));
  const activeNodeId = "activeNodeId" in snapshot ? snapshot.activeNodeId : undefined;
  const activeNode = snapshot.document.nodes.find((node) => node.metadata.id === activeNodeId)
    ?? snapshot.document.nodes[0];
  const activeNodeExecution = activeNode ? executionByNodeId.get(activeNode.metadata.id) : undefined;
  const contribution = activeNode ? getFlowNodeTypeContribution(activeNode.metadata.type) : undefined;
  const contributionSummary = activeNode ? contribution?.getSummary?.({ node: activeNode }) ?? [] : [];
  const coreValidationIssues = activeNode ? validateFlowNodeCoreMetadata(activeNode) : [];
  const contributionValidationIssues = activeNode
    ? contribution?.validateConfiguration?.({ node: activeNode }) ?? []
    : [];
  const validationIssues = [...coreValidationIssues, ...contributionValidationIssues];
  const runIfContextVariables = activeNode && snapshot.document
    ? buildRunIfContextVariables(snapshot.document, execution, activeNode)
    : [];

  if (!ctx || Object.keys(ctx).length === 0) {
    return (
      <div className="flow-context-view" data-context="flow-ctx">
        {activeNode && (
          <NodeConfigurationCard
            nodeId={activeNode.metadata.id}
            nodeType={activeNode.metadata.type}
            description={activeNode.metadata.description}
            runIf={activeNode.metadata.runIf}
            status={activeNodeExecution?.status ?? "pending"}
            summaries={contributionSummary}
            validationIssues={validationIssues}
            runIfContextVariables={runIfContextVariables}
            onUpdateMetadata={(patch) => updateActiveNodeMetadata(activeNode.metadata.id, patch)}
            configuration={contribution?.renderConfiguration?.({
              node: activeNode,
              updateMetadata: (patch) => updateActiveNodeMetadata(activeNode.metadata.id, patch)
            })}
          />
        )}
        <div className="flow-context-section">
          <div className="flow-context-section-header">Node Status</div>
          <div className="flow-context-node-list" role="list">
            {snapshot.document.nodes.map((node) => (
              <details className="flow-context-node-item" key={node.metadata.id}>
                <summary className="flow-context-node-summary">
                  <span className="flow-context-node-id">{node.metadata.id}</span>
                  <span className="flow-context-node-type">{node.metadata.type}</span>
                  <span className="flow-context-node-status pending">not-run</span>
                </summary>
              </details>
            ))}
          </div>
        </div>
        <div className="flow-context-empty">No flow context yet. Run a flow node.</div>
      </div>
    );
  }

  return (
    <div className="flow-context-view" data-context="flow-ctx">
      {activeNode && (
        <NodeConfigurationCard
          nodeId={activeNode.metadata.id}
          nodeType={activeNode.metadata.type}
          description={activeNode.metadata.description}
          runIf={activeNode.metadata.runIf}
          status={activeNodeExecution?.status ?? "pending"}
          summaries={contributionSummary}
          validationIssues={validationIssues}
          runIfContextVariables={runIfContextVariables}
          onUpdateMetadata={(patch) => updateActiveNodeMetadata(activeNode.metadata.id, patch)}
          configuration={contribution?.renderConfiguration?.({
            node: activeNode,
            updateMetadata: (patch) => updateActiveNodeMetadata(activeNode.metadata.id, patch)
          })}
        />
      )}
      <div className="flow-context-section">
        <div className="flow-context-section-header">Node Status</div>
        <div className="flow-context-node-list" role="list">
          {snapshot.document.nodes.map((node) => {
            const nodeExecution = executionByNodeId.get(node.metadata.id);
            const status = nodeExecution?.status ?? "pending";
            const label = status === "pending" ? "not-run" : status;

            return (
              <details className="flow-context-node-item" key={node.metadata.id}>
                <summary className="flow-context-node-summary">
                  <span className="flow-context-node-id">{node.metadata.id}</span>
                  <span className="flow-context-node-type">{node.metadata.type}</span>
                  <span className={`flow-context-node-status ${status}`.trim()}>{label}</span>
                </summary>
                {nodeExecution?.skipReason && (
                  <div className="flow-context-node-detail">skip: {nodeExecution.skipReason}</div>
                )}
                {nodeExecution?.error && (
                  <div className="flow-context-node-error">{nodeExecution.error.message}</div>
                )}
                {ctx[node.metadata.id] !== undefined && (
                  <div className="flow-context-node-ctx">
                    <JsonCompactTree value={ctx[node.metadata.id]} depth={0} maxDepth={3} />
                  </div>
                )}
              </details>
            );
          })}
        </div>
      </div>
      <div className="flow-context-section">
        <div className="flow-context-section-header">ctx (raw)</div>
        <details className="flow-context-raw-disclosure">
          <summary className="flow-context-raw-summary">Show raw ctx JSON</summary>
          <pre className="flow-context-json">{JSON.stringify(ctx, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}

export type ValidationIssue = {
  field: string;
  message: string;
};

function NodeConfigurationCard(props: {
  nodeId: string;
  nodeType: string;
  description?: string;
  runIf?: string;
  status: string;
  summaries: Array<{ label: string; value?: string; severity?: string }>;
  validationIssues: ValidationIssue[];
  runIfContextVariables: CtxVar[];
  onUpdateMetadata: (patch: Record<string, unknown>) => void;
  configuration?: React.ReactNode;
}): JSX.Element {
  const commitText = useCallback((key: string, value: string): void => {
    props.onUpdateMetadata({ [key]: value });
  }, [props.onUpdateMetadata]);
  const [runIfDraft, setRunIfDraft] = useState(props.runIf ?? "");

  useEffect(() => {
    setRunIfDraft(props.runIf ?? "");
  }, [props.nodeId, props.runIf]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (runIfDraft !== (props.runIf ?? "")) {
        commitText("runIf", runIfDraft);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [commitText, runIfDraft, props.runIf]);

  const nodeScopedIssues = filterNodeScopedIssues(props.validationIssues);

  const isInvalid = (field: string): boolean =>
    nodeScopedIssues.some((issue) => issue.field === field);

  const getFieldIssueMessage = (field: string): string | undefined =>
    nodeScopedIssues.find((issue) => issue.field === field)?.message;

  return (
    <div className="flow-context-section flow-node-sidecar-card">
      <div className="flow-context-section-header">Active Node</div>
      <div className="flow-node-sidecar-row">
        <span className="flow-node-sidecar-label">Id</span>
        <input
          className={`flow-node-sidecar-input ${isInvalid("id") ? "flow-node-sidecar-input-invalid" : ""}`.trim()}
          defaultValue={props.nodeId}
          key={`id:${props.nodeId}`}
          aria-invalid={isInvalid("id")}
          title={getFieldIssueMessage("id")}
          onBlur={(event) => commitText("id", event.currentTarget.value)}
        />
      </div>
      <div className="flow-node-sidecar-row">
        <span className="flow-node-sidecar-label">Type</span>
        <input
          className={`flow-node-sidecar-input ${isInvalid("type") ? "flow-node-sidecar-input-invalid" : ""}`.trim()}
          defaultValue={props.nodeType}
          key={`type:${props.nodeType}`}
          aria-invalid={isInvalid("type")}
          title={getFieldIssueMessage("type")}
          onBlur={(event) => commitText("type", event.currentTarget.value)}
        />
      </div>
      <div className="flow-node-sidecar-row">
        <span className="flow-node-sidecar-label">Status</span>
        <span className={`flow-context-node-status ${props.status}`.trim()}>{props.status === "pending" ? "not-run" : props.status}</span>
      </div>
      <div className="flow-node-sidecar-row">
        <span className="flow-node-sidecar-label">Description</span>
        <input
          className={`flow-node-sidecar-input ${isInvalid("description") ? "flow-node-sidecar-input-invalid" : ""}`.trim()}
          defaultValue={props.description ?? ""}
          key={`description:${props.nodeId}:${props.description ?? ""}`}
          placeholder="Optional description"
          aria-invalid={isInvalid("description")}
          title={getFieldIssueMessage("description")}
          onBlur={(event) => commitText("description", event.currentTarget.value)}
        />
      </div>
      <div className="flow-node-sidecar-row flow-node-sidecar-row-editor">
        <span className="flow-node-sidecar-label">runIf</span>
        <div
          className={isInvalid("runIf") ? "flow-node-sidecar-input-invalid" : undefined}
          aria-invalid={isInvalid("runIf")}
          title={getFieldIssueMessage("runIf")}
        >
          <WhenExpressionEditor
            value={runIfDraft}
            onChange={setRunIfDraft}
            height={72}
            wordWrap={false}
            showInfoPopover={false}
            contextVariables={props.runIfContextVariables}
          />
        </div>
      </div>
      {nodeScopedIssues.length > 0 && (
        <div className="flow-node-sidecar-validation-list" role="alert" aria-live="polite">
          {nodeScopedIssues.map((issue) => (
            <div className="flow-node-sidecar-validation-item" key={`${issue.field}:${issue.message}`}>
              {issue.message}
            </div>
          ))}
        </div>
      )}
      {props.summaries.length > 0 && (
        <div className="flow-node-sidecar-summary-list">
          {props.summaries.map((summary) => (
            <div className="flow-node-sidecar-row" key={summary.label}>
              <span className="flow-node-sidecar-label">{summary.label}</span>
              <span className="flow-node-sidecar-value">{summary.value ?? ""}</span>
            </div>
          ))}
        </div>
      )}
      {props.configuration && (
        <div className="flow-node-sidecar-contribution">
          {props.configuration}
        </div>
      )}
    </div>
  );
}

export function filterNodeScopedIssues(issues: ValidationIssue[]): ValidationIssue[] {
  return issues.filter((issue) =>
    issue.field === "id"
    || issue.field === "type"
    || issue.field === "description"
    || issue.field === "runIf"
    || issue.field.startsWith("jdbc.")
    || issue.field.startsWith("payloadbuilder.")
  );
}

const IDENTIFIER_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_DISCOVERED_CONTEXT_DEPTH = 3;
const MAX_DISCOVERED_KEYS_PER_OBJECT = 24;

export function buildRunIfContextVariables(
  document: FlowDocument,
  execution: FlowExecutionResult | undefined,
  activeNode: FlowNode
): CtxVar[] {
  const context = execution?.ctx ?? {};
  const variables: CtxVar[] = [];
  const seenNames = new Set<string>();

  const pushVariable = (variable: CtxVar): void => {
    const name = variable.name.trim();
    if (name.length === 0 || seenNames.has(name)) {
      return;
    }
    seenNames.add(name);
    variables.push({
      ...variable,
      name
    });
  };

  const pushDiscoveredLeafVariables = (path: string, value: unknown, depth: number): void => {
    if (depth > MAX_DISCOVERED_CONTEXT_DEPTH) {
      return;
    }

    if (typeof value === "string") {
      pushVariable({
        name: path,
        type: "string",
        description: "Flow context value"
      });
      return;
    }

    if (typeof value === "number") {
      pushVariable({
        name: path,
        type: "number",
        description: "Flow context value"
      });
      return;
    }

    if (typeof value === "boolean") {
      pushVariable({
        name: path,
        type: "boolean",
        description: "Flow context value"
      });
      return;
    }

    if (Array.isArray(value)) {
      pushVariable({
        name: path,
        type: "string",
        description: "Flow context array"
      });
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([key]) => IDENTIFIER_SEGMENT_PATTERN.test(key))
      .slice(0, MAX_DISCOVERED_KEYS_PER_OBJECT);

    for (const [key, childValue] of entries) {
      pushDiscoveredLeafVariables(`${path}.${key}`, childValue, depth + 1);
    }
  };

  const priorNodeIds = document.nodes
    .filter((node) => node.index < activeNode.index)
    .map((node) => node.metadata.id.trim())
    .filter((nodeId) => nodeId.length > 0);

  for (const nodeId of priorNodeIds) {
    pushVariable({
      name: `ctx.${nodeId}.status`,
      type: "string",
      description: "Node status"
    });
    pushVariable({
      name: `ctx.${nodeId}.nodeType`,
      type: "string",
      description: "Node type"
    });
    pushVariable({
      name: `ctx.${nodeId}.output.rowsAffected`,
      type: "number",
      description: "Rows affected"
    });
    pushVariable({
      name: `ctx.${nodeId}.output.rows`,
      type: "string",
      description: "Rows payload"
    });
    pushVariable({
      name: `ctx.${nodeId}.output.preview`,
      type: "string",
      description: "Output preview"
    });

    pushDiscoveredLeafVariables(`ctx.${nodeId}`, context[nodeId], 0);
  }

  return variables;
}

function JsonCompactTree(props: {
  value: unknown;
  depth: number;
  maxDepth: number;
}): JSX.Element {
  if (props.depth > props.maxDepth) {
    return <span className="flow-context-compact-leaf">...</span>;
  }

  if (props.value === null) {
    return <span className="flow-context-compact-leaf">null</span>;
  }

  if (typeof props.value === "string") {
    return <span className="flow-context-compact-leaf">"{props.value}"</span>;
  }

  if (typeof props.value === "number" || typeof props.value === "boolean") {
    return <span className="flow-context-compact-leaf">{String(props.value)}</span>;
  }

  if (Array.isArray(props.value)) {
    if (props.value.length === 0) {
      return <span className="flow-context-compact-leaf">[]</span>;
    }

    return (
      <details className="flow-context-compact-node">
        <summary className="flow-context-compact-summary">[{props.value.length}]</summary>
        <div className="flow-context-compact-children">
          {props.value.slice(0, 8).map((item, index) => (
            <div key={index} className="flow-context-compact-entry">
              <span className="flow-context-compact-key">{index}:</span>
              <JsonCompactTree value={item} depth={props.depth + 1} maxDepth={props.maxDepth} />
            </div>
          ))}
          {props.value.length > 8 && <div className="flow-context-compact-more">+{props.value.length - 8} more</div>}
        </div>
      </details>
    );
  }

  if (typeof props.value === "object") {
    const entries = Object.entries(props.value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="flow-context-compact-leaf">{"{}"}</span>;
    }

    return (
      <details className="flow-context-compact-node">
        <summary className="flow-context-compact-summary">{"{"}{entries.length}{"}"}</summary>
        <div className="flow-context-compact-children">
          {entries.slice(0, 12).map(([key, value]) => (
            <div key={key} className="flow-context-compact-entry">
              <span className="flow-context-compact-key">{key}:</span>
              <JsonCompactTree value={value} depth={props.depth + 1} maxDepth={props.maxDepth} />
            </div>
          ))}
          {entries.length > 12 && <div className="flow-context-compact-more">+{entries.length - 12} more</div>}
        </div>
      </details>
    );
  }

  return <span className="flow-context-compact-leaf">{String(props.value)}</span>;
}
