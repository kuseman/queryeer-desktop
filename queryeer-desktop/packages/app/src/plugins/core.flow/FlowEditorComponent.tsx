import { useEffect, useRef, useState } from "react";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { EditorRegistryHost } from "@queryeer/api/editor/EditorCapability";
import type { OutlineRegistry } from "@queryeer/api/extensions/OutlineExtension";
import type { DialogExtension } from "@queryeer/api/extensions/DialogExtension";
import { TextEditorComponent } from "../core.editor/texteditor/TextEditorComponent";
import { TextEditorRegistry } from "../core.editor/texteditor/TextEditorRegistry";
import { MouseTargetType } from "../core.editor/texteditor/types";
import { executeFlowDocument } from "./qflow-executor";
import { parseQflowDocument } from "./qflow-parser";
import { getFlowStateStore, useFlowStateSnapshot } from "./flow-state";
import type { FlowRunMode } from "./types";
import { setActiveFlowCommandHandlers } from "./flow-command-handlers";
import {
  toFlowInlineNodeMarkers
} from "./flow-inline-presenter";
import {
  buildMetadataCollapseFallbackDecorations,
  buildMetadataCollapsePlan,
  FLOW_METADATA_COLLAPSE_STATE_KEY,
  normalizeExpandedMetadataNodeIds,
  readPersistedExpandedMetadataNodeIds,
  toPersistedExpandedMetadataNodeIds
} from "./flow-metadata-collapse";
import {
  FLOW_ENVIRONMENTS_SETTING_ID,
  listFlowEnvironmentNames,
  parseFlowEnvironmentConfig,
  withActiveFlowEnvironment
} from "./flow-environment";
import { getFilesRegistry } from "../core.commands/files-registry-accessor";
import { getCoreSettingsService } from "../core.settings/service";
import { requestFocusSidebarView } from "../../renderer/shell/layout-sidebar-events";
import { FLOW_CONTEXT_VIEW_ID } from "./flow-layout-ids";

type Props = {
  file?: FileEntity;
  editorRegistryHost?: EditorRegistryHost;
  outlineRegistry?: OutlineRegistry;
  dialog?: DialogExtension;
};

export const flowTextRegistry = new TextEditorRegistry();

export function FlowEditorComponent({ file, editorRegistryHost, outlineRegistry, dialog }: Props): JSX.Element {
  const [statusMessage, setStatusMessage] = useState("Ready");
  const [statusClassName, setStatusClassName] = useState("");
  const [environmentConfig, setEnvironmentConfig] = useState(() => parseFlowEnvironmentConfig(undefined));
  const [expandedMetadataNodeIds, setExpandedMetadataNodeIds] = useState<ReadonlySet<string>>(() => new Set());
  const fileId = file?.fileId ?? null;
  const snapshot = useFlowStateSnapshot(fileId);
  const hasExecution = Boolean(snapshot.execution);
  const hasRunningExecution = snapshot.execution?.nodes.some((node) => node.status === "running") ?? false;
  const canContinue = hasExecution
    && !hasRunningExecution
    && !snapshot.execution?.failedNodeId
    && (snapshot.execution?.nodes.some((node) => node.status === "pending") ?? false);

  useEffect(() => {
    if (!fileId) {
      setExpandedMetadataNodeIds((current) => (current.size > 0 ? new Set<string>() : current));
      return;
    }

    const persistedExpandedNodeIds = readExpandedMetadataNodeIdsForFile(fileId);
    const normalizedExpandedNodeIds = snapshot.document
      ? normalizeExpandedMetadataNodeIds(snapshot.document, persistedExpandedNodeIds)
      : persistedExpandedNodeIds;

    setExpandedMetadataNodeIds((current) =>
      areStringSetsEqual(current, normalizedExpandedNodeIds)
        ? current
        : normalizedExpandedNodeIds
    );

    if (!areStringSetsEqual(persistedExpandedNodeIds, normalizedExpandedNodeIds)) {
      persistExpandedMetadataNodeIdsForFile(fileId, normalizedExpandedNodeIds);
    }
  }, [fileId, snapshot.document]);

  useEffect(() => {
    const settings = getCoreSettingsService();
    if (!settings) {
      return;
    }

    const syncEnvironment = (): void => {
      setEnvironmentConfig(parseFlowEnvironmentConfig(settings.getValue(FLOW_ENVIRONMENTS_SETTING_ID)));
    };
    syncEnvironment();
    return settings.subscribe(syncEnvironment);
  }, []);

  useEffect(() => {
    if (!file || !fileId) {
      return;
    }

    const syncDocument = (): void => {
      const existingModel = flowTextRegistry.getModelForFile(fileId);
      if (!existingModel) {
        return;
      }
      const parsed = parseQflowDocument(existingModel.getContent());
      getFlowStateStore().setDocument(fileId, parsed);
    };

    syncDocument();

    const subscription = flowTextRegistry.subscribe(() => {
      syncDocument();
    });

    const parseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const unsubscribeDirty = flowTextRegistry.onContentDirty((dirtyFileId, text) => {
      if (dirtyFileId !== fileId) {
        return;
      }
      if (parseTimerRef.current !== null) {
        clearTimeout(parseTimerRef.current);
      }
      parseTimerRef.current = setTimeout(() => {
        parseTimerRef.current = null;
        const parsed = parseQflowDocument(text);
        getFlowStateStore().setDocument(fileId, parsed);
      }, 80);
    });

    return () => {
      subscription.dispose();
      unsubscribeDirty();
      if (parseTimerRef.current !== null) {
        clearTimeout(parseTimerRef.current);
      }
    };
  }, [file, fileId]);

  useEffect(() => {
    if (!fileId) {
      return;
    }
    const editor = flowTextRegistry.getActiveEditor();
    if (!editor) {
      return;
    }

    const updateActiveNode = (lineNumber: number): void => {
      const document = getFlowStateStore().getDocument(fileId);
      const node = document?.nodes.find((candidate) =>
        lineNumber >= candidate.range.metadataStartLine
        && lineNumber <= candidate.range.actionEndLine
      );
      getFlowStateStore().setActiveNode(fileId, node?.metadata.id);
    };

    const position = editor.getPosition();
    if (position) {
      updateActiveNode(position.lineNumber);
    }

    const subscription = editor.onDidChangeCursorPosition((event) => {
      updateActiveNode(event.position.lineNumber);
    });
    return () => {
      subscription.dispose();
    };
  }, [fileId, snapshot.document]);

  useEffect(() => {
    const editor = flowTextRegistry.getActiveEditor();
    if (!editor || !fileId) {
      return;
    }
    editor.updateOptions({ glyphMargin: true });
    const subscription = editor.onMouseDown((event) => {
      if (event.target.type !== MouseTargetType.GUTTER_GLYPH_MARGIN || !event.target.position) {
        return;
      }
      const lineNumber = event.target.position.lineNumber;
      const node = getFlowStateStore().getDocument(fileId)?.nodes.find((candidate) =>
        lineNumber === candidate.range.metadataStartLine
      );
      if (!node) {
        return;
      }
      setExpandedMetadataNodeIds((current) => {
        const next = new Set(current);
        if (next.has(node.metadata.id)) {
          next.delete(node.metadata.id);
        } else {
          next.add(node.metadata.id);
        }
        const currentDocument = getFlowStateStore().getDocument(fileId);
        if (!currentDocument) {
          return current;
        }
        const normalizedNext = normalizeExpandedMetadataNodeIds(currentDocument, next);
        if (!areStringSetsEqual(current, normalizedNext)) {
          persistExpandedMetadataNodeIdsForFile(fileId, normalizedNext);
        }
        return normalizedNext;
      });
    });
    return () => {
      subscription.dispose();
    };
  }, [fileId, snapshot.document]);

  useEffect(() => {
    if (!fileId) {
      setStatusMessage("Ready");
      setStatusClassName("");
      return;
    }

    const execution = snapshot.execution;
    if (!execution) {
      setStatusMessage("Ready");
      setStatusClassName("");
      return;
    }

    const runningNode = execution.nodes.find((node) => node.status === "running");
    if (runningNode) {
      setStatusMessage(`Running '${runningNode.nodeId}'...`);
      setStatusClassName("running");
      return;
    }

    if (execution.failedNodeId) {
      setStatusMessage(`Failed at '${execution.failedNodeId}'.`);
      setStatusClassName("failed");
      return;
    }
    if (execution.nodes.some((node) => node.status === "pending")) {
      setStatusMessage(`Paused (${execution.nodes.filter((node) => node.status === "completed").length} completed).`);
      setStatusClassName("");
      return;
    }

    setStatusMessage(`Completed (${execution.nodes.filter((node) => node.status === "completed").length} nodes).`);
    setStatusClassName("completed");
  }, [fileId, snapshot.execution]);

  const getModeTooltip = (mode: FlowRunMode): string => {
    if (mode.kind === "all") {
      return "Run the entire flow from the first node.";
    }
    if (mode.kind === "from-node") {
      return "Continue from the target node using the current execution context.";
    }
    if (mode.kind === "to-node") {
      return "Run from start through this node to build context.";
    }
    return "Run only this node using current context; does not run downstream nodes.";
  };

  const runFlow = async (mode: FlowRunMode): Promise<void> => {
    if (!fileId) {
      return;
    }

    const model = flowTextRegistry.getModelForFile(fileId);
    if (!model) {
      return;
    }

    const document = parseQflowDocument(model.getContent());
    getFlowStateStore().setDocument(fileId, document);
    if (document.nodes.length === 0) {
      getFlowStateStore().clearExecution(fileId);
      setStatusMessage("No flow nodes found.");
      setStatusClassName("failed");
      return;
    }

    if (document.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
      getFlowStateStore().clearExecution(fileId);
      setStatusMessage("Flow document has parse errors.");
      setStatusClassName("failed");
      return;
    }

    const shouldReuseExecution = mode.kind === "node-only" || mode.kind === "from-node";
    const result = await executeFlowDocument(
      document,
      mode,
      {
        fileId,
        onProgress: (progress) => {
          getFlowStateStore().setExecution(fileId, progress);
        },
        ...(shouldReuseExecution ? { previousExecution: snapshot.execution } : {})
      }
    );
    getFlowStateStore().setExecution(fileId, result);
  };

  const clearExecution = (): void => {
    if (!fileId) {
      return;
    }
    getFlowStateStore().clearExecution(fileId);
    setStatusMessage("Ready");
    setStatusClassName("");
  };

  const setActiveEnvironment = async (environment: string): Promise<void> => {
    const settings = getCoreSettingsService();
    if (!settings) {
      return;
    }
    const current = parseFlowEnvironmentConfig(settings.getValue(FLOW_ENVIRONMENTS_SETTING_ID));
    const next = withActiveFlowEnvironment(current, environment);
    const result = await settings.setValue(FLOW_ENVIRONMENTS_SETTING_ID, next);
    if (!result.ok) {
      await dialog?.showMessage({
        title: "Unable To Update Flow Environment",
        message: result.message,
        severity: "error"
      });
      return;
    }
    setEnvironmentConfig(next);
  };

  const createEnvironment = async (): Promise<void> => {
    const response = await dialog?.showInputDialog?.({
      title: "New Flow Environment",
      message: "Enter a local flow environment name.",
      placeholder: "dev"
    });
    if (!response || response.canceled || !response.value?.trim()) {
      return;
    }
    await setActiveEnvironment(response.value.trim());
  };

  const continueFlow = async (): Promise<void> => {
    const execution = snapshot.execution;
    if (!execution) {
      await runFlow({ kind: "all" });
      return;
    }

    const nextPending = execution.nodes.find((node) => node.status === "pending");
    if (!nextPending) {
      await runFlow({ kind: "all" });
      return;
    }

    await runFlow({ kind: "from-node", nodeId: nextPending.nodeId });
  };

  const getNodeIdAtCursor = (): string | undefined => {
    if (!fileId) {
      return undefined;
    }
    const position = flowTextRegistry.getActiveEditor()?.getPosition();
    if (!position) {
      return undefined;
    }
    const document = getFlowStateStore().getDocument(fileId);
    return document?.nodes.find((node) =>
      position.lineNumber >= node.range.metadataStartLine
      && position.lineNumber <= node.range.actionEndLine
    )?.metadata.id;
  };

  useEffect(() => {
    if (!fileId) {
      return;
    }
    return setActiveFlowCommandHandlers({
      runNode: async (nodeId) => {
        const targetNodeId = nodeId ?? getNodeIdAtCursor();
        if (targetNodeId) {
          await runFlow({ kind: "node-only", nodeId: targetNodeId });
        }
      },
      runToNode: async (nodeId) => {
        const targetNodeId = nodeId ?? getNodeIdAtCursor();
        if (targetNodeId) {
          await runFlow({ kind: "to-node", nodeId: targetNodeId });
        }
      },
      configureNode: (nodeId) => {
        const targetNodeId = nodeId ?? getNodeIdAtCursor();
        if (targetNodeId) {
          getFlowStateStore().setActiveNode(fileId, targetNodeId);
          requestFocusSidebarView({
            zone: "primarySidebar",
            viewId: FLOW_CONTEXT_VIEW_ID
          });
        }
      }
    });
  }, [fileId, snapshot.document, snapshot.execution]);

  useEffect(() => {
    const editor = flowTextRegistry.getActiveEditor();
    if (!editor) {
      return;
    }

    const model = flowTextRegistry.getModelForFile(fileId ?? "");
    if (!model || !snapshot.document) {
      editor.clearLineDecorations("core.flow.inline.node");
      editor.clearLineDecorations("core.flow.metadata.toggle");
      editor.clearLineDecorations("core.flow.metadata.fallback");
      editor.clearHiddenAreas("core.flow.metadata");
      return;
    }

    const decorators = toFlowInlineNodeMarkers({
      nodes: snapshot.document.nodes,
      executionNodes: snapshot.execution?.nodes
    }).map((marker) => ({
      lineNumber: marker.lineNumber,
      lineClassName: `flow-inline-node-line flow-inline-node-line-${marker.statusClass}`,
      hoverMessage: marker.hoverMessage
    }));

    editor.setLineDecorations("core.flow.inline.node", decorators);
    const metadataCollapsePlan = buildMetadataCollapsePlan({
      document: snapshot.document,
      expandedNodeIds: expandedMetadataNodeIds
    });
    editor.setLineDecorations("core.flow.metadata.toggle", metadataCollapsePlan.toggleDecorations);

    if (editor.supportsHiddenAreas()) {
      editor.clearLineDecorations("core.flow.metadata.fallback");
      editor.setHiddenAreas("core.flow.metadata", metadataCollapsePlan.hiddenRanges);
    } else {
      editor.clearHiddenAreas("core.flow.metadata");
      editor.setLineDecorations(
        "core.flow.metadata.fallback",
        buildMetadataCollapseFallbackDecorations({
          document: snapshot.document,
          expandedNodeIds: expandedMetadataNodeIds,
          lineClassName: "flow-metadata-collapsed-line"
        })
      );
    }

    return () => {
      editor.clearLineDecorations("core.flow.inline.node");
      editor.clearLineDecorations("core.flow.metadata.toggle");
      editor.clearLineDecorations("core.flow.metadata.fallback");
      editor.clearHiddenAreas("core.flow.metadata");
    };
  }, [expandedMetadataNodeIds, fileId, snapshot.document, snapshot.execution]);

  return (
    <div className="flow-editor-shell">
      <div className="flow-editor-header">
        <button
          type="button"
          className="flow-editor-button"
          title="Clear the current execution session and context."
          onClick={() => {
            clearExecution();
          }}
          disabled={!fileId || !hasExecution}
        >
          <span className="codicon codicon-clear-all" aria-hidden="true" />
          <span>Clear</span>
        </button>
        <button
          type="button"
          className="flow-editor-button"
          title={canContinue
            ? getModeTooltip({ kind: "from-node", nodeId: "next" })
            : getModeTooltip({ kind: "all" })}
          onClick={() => {
            if (canContinue) {
              void continueFlow();
              return;
            }
            void runFlow({ kind: "all" });
          }}
          disabled={!fileId || hasRunningExecution}
        >
          <span className="codicon codicon-play" aria-hidden="true" />
          <span>{canContinue ? "Continue" : "Run"}</span>
        </button>
        <label className="flow-environment-selector" title="Active flow environment for contribution-owned node configuration.">
          <span>Environment</span>
          <select
            value={environmentConfig.activeEnvironment}
            onChange={(event) => {
              void setActiveEnvironment(event.target.value);
            }}
          >
            {listFlowEnvironmentNames(environmentConfig).map((environment) => (
              <option key={environment} value={environment}>{environment}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="flow-editor-button secondary"
          title="Create and switch to a new local flow environment."
          onClick={() => {
            void createEnvironment();
          }}
        >
          <span className="codicon codicon-add" aria-hidden="true" />
        </button>
        <span className={`flow-editor-status ${statusClassName}`.trim()}>{statusMessage}</span>
      </div>
      <div className="flow-editor-body">
        <TextEditorComponent
          file={file}
          registry={flowTextRegistry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={outlineRegistry}
          editorId="core.flow.editor"
        />
      </div>
    </div>
  );
}

function readExpandedMetadataNodeIdsForFile(fileId: string): ReadonlySet<string> {
  return readPersistedExpandedMetadataNodeIds(
    getFilesRegistry()?.getEditorState(fileId, FLOW_METADATA_COLLAPSE_STATE_KEY)
  );
}

function persistExpandedMetadataNodeIdsForFile(
  fileId: string,
  expandedNodeIds: ReadonlySet<string>
): void {
  getFilesRegistry()?.setEditorState(
    fileId,
    FLOW_METADATA_COLLAPSE_STATE_KEY,
    toPersistedExpandedMetadataNodeIds(expandedNodeIds)
  );
}

function areStringSetsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
