import React, { useState, useEffect, useRef, useCallback } from "react";
import { TextEditorComponent } from "../core.editor/texteditor/TextEditorComponent";
import { OutputPanel } from "./output/OutputPanel";
import type { OutputContext, OutputMessage, ResultSet, ColumnType } from "../../contracts/extensions/OutputExtension";
import { IDLE_OUTPUT_CONTEXT, DEFAULT_OUTPUT_LIMITS } from "../../contracts/extensions/OutputExtension";
import { getQueryEngineService } from "./QueryEngineService";
import { getOutputRegistry } from "./output/OutputRegistry";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { getQueryViewStateStore, TEXT_OUTPUT_PRIMARY_ID } from "./QueryViewStateStore";
import { getCoreSecurityService } from "../core.security/service";
import { TEXT_OUTPUT_FORMATTERS } from "../core.queryengine.output.text/formatters";
import type { EditorRegistryHost } from "../../contracts/editor/EditorCapability";
import type { OutlineRegistry } from "../../contracts/extensions/OutlineExtension";

type Props = {
  file?: FileEntity;
  editorRegistryHost?: EditorRegistryHost;
  outlineRegistry?: OutlineRegistry;
};

type ActiveExecution = {
  executionId: string;
  unsubscribe: () => void;
};

type ExecutionAnchor = {
  line: number;
  column: number;
};

function toAbsoluteLocation(anchor: ExecutionAnchor, line?: number, column?: number): { line?: number; column?: number } {
  if (line === undefined) {
    return { line: undefined, column: undefined };
  }
  const absoluteLine = anchor.line + Math.max(0, line - 1);
  if (column === undefined) {
    return { line: absoluteLine, column: undefined };
  }
  const absoluteColumn = line <= 1 ? anchor.column + Math.max(0, column - 1) : column;
  return { line: absoluteLine, column: absoluteColumn };
}

const OUTPUT_CONTEXT_KEY = defineStateKey<OutputContext>("core.queryengine.outputContext");
const PLAN_OUTPUT_ID = "core.graph.queryPlanOutput";

export function QueryEditorComponent({ file, editorRegistryHost, outlineRegistry }: Props): JSX.Element {
  const [outputContext, setOutputContext] = useState<OutputContext>(IDLE_OUTPUT_CONTEXT);
  const [splitPercent, setSplitPercent] = useState(60);
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<string | null>(null);

  const activeExecutionByFileIdRef = useRef(new Map<string, ActiveExecution>());
  const executionAnchorByFileIdRef = useRef(new Map<string, ExecutionAnchor>());
  const securityRetryCountByFileIdRef = useRef(new Map<string, number>());
  const executionPrimaryOverrideByFileIdRef = useRef(new Map<string, string | null>());
  const handleExecuteRef = useRef<() => void>(() => {});
  const handleCancelRef = useRef<() => void>(() => {});
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const fileIdRef = useRef(file?.fileId);
  fileIdRef.current = file?.fileId;

  // Restore per-file context and primary selection on tab switch
  useEffect(() => {
    const fileId = file?.fileId;
    if (!fileId) {
      setOutputContext(IDLE_OUTPUT_CONTEXT);
      setSelectedPrimaryId(null);
      return;
    }
    const reg = getFileStateRegistry();
    const restoredContext = reg.get(fileId, OUTPUT_CONTEXT_KEY) ?? IDLE_OUTPUT_CONTEXT;
    const queryViewState = getQueryViewStateStore().read(fileId);
    setOutputContext({
      ...restoredContext,
      artifacts: restoredContext.artifacts ?? [],
      fileId,
      textOutputFormat: queryViewState.textOutputFormat ?? restoredContext.textOutputFormat ?? "plain"
    });
    const override = executionPrimaryOverrideByFileIdRef.current.get(fileId);
    setSelectedPrimaryId(
      queryViewState.panelActiveOutputId
      ?? override
      ?? null
    );
  }, [file?.fileId]);

  useEffect(() => {
    if (!file?.fileId) {
      return;
    }

    const raf = requestAnimationFrame(() => {
      editorRegistryHost?.getActiveEditor()?.focus?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [file?.fileId]);

  useEffect(() => {
    const fileId = file?.fileId;
    if (!fileId) {
      return;
    }
    return getQueryViewStateStore().subscribe(fileId, (state) => {
      const override = executionPrimaryOverrideByFileIdRef.current.get(fileId);
      const validFormatIds = new Set<string>(TEXT_OUTPUT_FORMATTERS.map((formatter) => formatter.id));
      if (state.panelActiveOutputId !== undefined) {
        setSelectedPrimaryId(state.panelActiveOutputId);
      } else if (override !== undefined) {
        setSelectedPrimaryId(override);
      }
      setOutputContext((prev) => ({
        ...prev,
        textOutputFormat: state.textOutputFormat && validFormatIds.has(state.textOutputFormat)
          ? state.textOutputFormat
          : prev.textOutputFormat
      }));
    });
  }, [file?.fileId]);

  const updateOutputContextForFile = useCallback(
    (targetFileId: string, updater: (prev: OutputContext) => OutputContext) => {
      const reg = getFileStateRegistry();
      const prev = reg.get(targetFileId, OUTPUT_CONTEXT_KEY) ?? IDLE_OUTPUT_CONTEXT;
      const next = updater(prev);
      reg.set(targetFileId, OUTPUT_CONTEXT_KEY, next);
      if (fileIdRef.current === targetFileId) {
        setOutputContext(next);
      }
    },
    []
  );

  const setExecutionPrimaryOverride = useCallback((targetFileId: string, outputId: string | null) => {
    if (outputId === null) {
      executionPrimaryOverrideByFileIdRef.current.delete(targetFileId);
    } else {
      executionPrimaryOverrideByFileIdRef.current.set(targetFileId, outputId);
    }
    if (fileIdRef.current === targetFileId) {
      const persisted =
        getQueryViewStateStore().read(targetFileId).panelActiveOutputId
        ?? null;
      setSelectedPrimaryId(outputId ?? persisted);
    }
  }, []);

  const handleExecute = useCallback(() => {
    const run = async () => {
      const targetFileId = file?.fileId;
      if (!targetFileId) return;
      if (!securityRetryCountByFileIdRef.current.has(targetFileId)) {
        securityRetryCountByFileIdRef.current.set(targetFileId, 0);
      }

      // Cancel any existing execution for this file before starting a new one
      const existingExecution = activeExecutionByFileIdRef.current.get(targetFileId);
      if (existingExecution) {
        existingExecution.unsubscribe();
        await getQueryEngineService().cancel(existingExecution.executionId).catch(() => {});
        activeExecutionByFileIdRef.current.delete(targetFileId);
      }

      const executeOptions = getQueryEngineService().consumeExecuteOptions();

      const handle = editorRegistryHost?.getActiveEditor();
      const selectedText = handle?.selection?.getSelectedText() ?? "";
      const fullText = handle?.selection?.getContent() ?? "";
      const text = executeOptions?.textOverride ?? (selectedText.trim() ? selectedText : fullText);
      if (!text.trim()) return;

      const selection = !executeOptions?.textOverride ? (handle?.selection?.getSelection?.() ?? null) : null;
      const anchor: ExecutionAnchor = !executeOptions?.textOverride && selectedText.trim() && selection
        ? {
            line: Math.min(selection.selectionStartLineNumber, selection.positionLineNumber),
            column:
              selection.selectionStartLineNumber < selection.positionLineNumber
                ? selection.selectionStartColumn
                : (selection.selectionStartLineNumber > selection.positionLineNumber
                  ? selection.positionColumn
                  : Math.min(selection.selectionStartColumn, selection.positionColumn))
          }
        : { line: 1, column: 1 };
      executionAnchorByFileIdRef.current.set(targetFileId, anchor);

      const panelState = getQueryViewStateStore().read(targetFileId);
      const selectedFromToolbar = executeOptions?.outputIdOverride ?? panelState.executionTargetOutputId;
      const outputRegistry = getOutputRegistry();
      const selectablePrimaryIds = outputRegistry.getSelectablePrimaryContributors().map((output) => output.id);
      const isSelectedPrimary = selectedFromToolbar
        ? selectablePrimaryIds.includes(selectedFromToolbar)
        : false;
      const registrySelectedPrimaryId = outputRegistry.getSelectedPrimaryId();
      const fallbackPrimaryId = registrySelectedPrimaryId && selectablePrimaryIds.includes(registrySelectedPrimaryId)
        ? registrySelectedPrimaryId
        : TEXT_OUTPUT_PRIMARY_ID;
      const targetPrimaryCandidate = isSelectedPrimary ? selectedFromToolbar : panelState.executionTargetOutputId;
      const targetPrimaryId = targetPrimaryCandidate && selectablePrimaryIds.includes(targetPrimaryCandidate)
        ? targetPrimaryCandidate
        : fallbackPrimaryId;
      const panelOutputId = selectedFromToolbar
        ?? panelState.panelActiveOutputId
        ?? targetPrimaryId;

      getQueryViewStateStore().setPanelSelectedOutput(targetFileId, panelOutputId);
      setExecutionPrimaryOverride(targetFileId, panelOutputId ?? null);

      const persistedFormat = getQueryViewStateStore().read(targetFileId).textOutputFormat;
      updateOutputContextForFile(targetFileId, (prev) => ({
        ...IDLE_OUTPUT_CONTEXT,
        fileId: targetFileId,
        state: "running",
        textOutputFormat: persistedFormat ?? prev.textOutputFormat,
        rowsTargetPrimaryId: targetPrimaryId,
        fetchedRowCount: 0,
        executionStartedAtMs: Date.now()
      }));

      try {
        const service = getQueryEngineService();
        const executionId = await service.execute({
          fileId: targetFileId,
          text,
          ...(executeOptions?.optionsOverride ? { options: executeOptions.optionsOverride } : {})
        });

        const unsubscribe = service.subscribe(executionId, (event) => {
          if (event.method === "queryengine.progress") {
            const p = event.params as { percent?: number; message?: string };
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              progress: { percent: p.percent, message: p.message }
            }));
          } else if (event.method === "queryengine.chunkStart") {
            const p = event.params as { resultSetIndex: number; schema: { columns: Array<{ name: string; type: ColumnType }>; metadata?: Record<string, string> } };
            updateOutputContextForFile(targetFileId, (prev) => {
              if (prev.resultSets.some((rs) => rs.resultSetIndex === p.resultSetIndex)) return prev;
              return {
                ...prev,
                resultSets: [
                  ...prev.resultSets,
                  { resultSetIndex: p.resultSetIndex, schema: p.schema, metadata: p.schema.metadata, rows: [], rowLimitExceeded: false }
                ]
              };
            });
          } else if (event.method === "queryengine.chunkRows") {
            const p = event.params as {
              resultSetIndex: number;
              rows: unknown[][];
              messages?: Array<{ severity: string; message: string; line?: number; column?: number }>;
            };
            const registry = getOutputRegistry();

            const currentCtx = getFileStateRegistry().get(targetFileId, OUTPUT_CONTEXT_KEY) ?? IDLE_OUTPUT_CONTEXT;
            const rowsTargetPrimaryId = currentCtx.rowsTargetPrimaryId;

            // Handle output messages (info/warnings/errors from the engine)
            if (p.messages && p.messages.length > 0) {
              const executionAnchor = executionAnchorByFileIdRef.current.get(targetFileId) ?? { line: 1, column: 1 };
              const outputMessages: OutputMessage[] = p.messages.map((m) => ({
                ...toAbsoluteLocation(
                  executionAnchor,
                  m.line ?? (typeof (m as { details?: Record<string, unknown> }).details?.line === "number" ? (m as { details?: Record<string, unknown> }).details!.line as number : undefined),
                  m.column ?? (typeof (m as { details?: Record<string, unknown> }).details?.column === "number" ? (m as { details?: Record<string, unknown> }).details!.column as number : undefined)
                ),
                severity: m.severity as "info" | "error",
                message: m.message
              }));
              updateOutputContextForFile(targetFileId, (prev) => ({
                ...prev,
                output: [...prev.output, ...outputMessages]
              }));
            }

            // Message-only chunks (no rows) skip row processing
            if (p.rows.length === 0) {
              return;
            }

            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              fetchedRowCount: prev.fetchedRowCount + p.rows.length
            }));

            // Notify the primary contributor before updating state so Ag-Grid can
            // call applyTransaction() incrementally rather than diffing the full rows array.
            registry.notifyChunkRows({ resultSetIndex: p.resultSetIndex, rows: p.rows }, rowsTargetPrimaryId);

            // Check if this result set is already over the limit
            const currentSet = currentCtx.resultSets.find((rs) => rs.resultSetIndex === p.resultSetIndex);

            if (currentSet?.rowLimitExceeded) {
              // Pipe overflow rows to the export file — do not accumulate in memory
              void window.appShell.appendExportChunk({
                executionId,
                resultSetIndex: p.resultSetIndex,
                rows: p.rows
              });
              return;
            }

            updateOutputContextForFile(targetFileId, (prev) => {
              const sets = prev.resultSets.map((rs): ResultSet => {
                if (rs.resultSetIndex !== p.resultSetIndex) return rs;
                const combined = [...rs.rows, ...p.rows];
                if (combined.length >= DEFAULT_OUTPUT_LIMITS.maxRows) {
                  // Open the export stream for this result set (fire-and-forget; path resolved on completed)
                  void window.appShell.openExportStream({ executionId, resultSetIndex: p.resultSetIndex });
                  return { ...rs, rows: combined.slice(0, DEFAULT_OUTPUT_LIMITS.maxRows), rowLimitExceeded: true };
                }
                return { ...rs, rows: combined };
              });
              return {
                ...prev,
                resultSets: sets
              };
            });
          } else if (event.method === "queryengine.completed") {
            const p = event.params as { metrics?: { durationMs?: number; rowCount?: number }; features?: string[]; artifacts?: OutputContext["artifacts"] };
            const artifacts = p.artifacts ?? [];
            const hasPlanGraphArtifact = artifacts.some((artifact) => artifact.kind === "graph" && artifact.capability === "plan");
            activeExecutionByFileIdRef.current.delete(targetFileId);
            securityRetryCountByFileIdRef.current.delete(targetFileId);
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "completed",
              metrics: p.metrics ?? null,
              features: p.features ?? ["rows"],
              artifacts,
              progress: null,
              executionStartedAtMs: null
            }));

            if (hasPlanGraphArtifact) {
              getQueryViewStateStore().setPanelSelectedOutput(targetFileId, PLAN_OUTPUT_ID);
            }
            setExecutionPrimaryOverride(targetFileId, null);

            // Finalize any open export streams and patch exportPath back into the result set
            const ctx = getFileStateRegistry().get(targetFileId, OUTPUT_CONTEXT_KEY) ?? IDLE_OUTPUT_CONTEXT;
            for (const rs of ctx.resultSets) {
              if (rs.rowLimitExceeded) {
                void window.appShell
                  .finalizeExportStream({ executionId, resultSetIndex: rs.resultSetIndex })
                  .then(({ exportPath }) => {
                    updateOutputContextForFile(targetFileId, (prev) => ({
                      ...prev,
                      resultSets: prev.resultSets.map((s) =>
                        s.resultSetIndex === rs.resultSetIndex ? { ...s, exportPath } : s
                      )
                    }));
                  });
              }
            }
          } else if (event.method === "queryengine.failed") {
            const p = event.params as {
              error?: { code: string; message: string; details?: Record<string, unknown> };
            };
            const executionAnchor = executionAnchorByFileIdRef.current.get(targetFileId) ?? { line: 1, column: 1 };
            const relativeLine =
              typeof p.error?.details?.line === "number"
                ? p.error.details.line
                : undefined;
            const relativeColumn =
              typeof p.error?.details?.column === "number"
                ? p.error.details.column
                : undefined;
            const absoluteLocation = toAbsoluteLocation(executionAnchor, relativeLine, relativeColumn);
            const errorWithLocation = p.error
              ? {
                  ...p.error,
                  details: {
                    ...(p.error.details ?? {}),
                    ...(absoluteLocation.line !== undefined ? { line: absoluteLocation.line } : {}),
                    ...(absoluteLocation.column !== undefined ? { column: absoluteLocation.column } : {})
                  }
                }
              : null;
            if (p.error?.code === "SECURITY_SESSION_CLOSED") {
              void (async () => {
                const security = getCoreSecurityService();
                if (security) {
                  const accepted = await security.ensureUnlockedForSecretAccess({ interactive: true });
                  const retryCount = securityRetryCountByFileIdRef.current.get(targetFileId) ?? 0;
                  if (accepted && retryCount < 1) {
                    securityRetryCountByFileIdRef.current.set(targetFileId, retryCount + 1);
                    handleExecuteRef.current();
                    return;
                  }
                }
                activeExecutionByFileIdRef.current.delete(targetFileId);
                securityRetryCountByFileIdRef.current.delete(targetFileId);
                updateOutputContextForFile(targetFileId, (prev) => ({
                  ...prev,
                  state: "failed",
                  error: errorWithLocation,
                  progress: null,
                  executionStartedAtMs: null
                }));
                getQueryViewStateStore().setPanelSelectedOutput(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
                setExecutionPrimaryOverride(targetFileId, null);
              })();
              return;
            }
            activeExecutionByFileIdRef.current.delete(targetFileId);
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "failed",
              error: errorWithLocation ?? { code: "UNKNOWN", message: "Query failed" },
              progress: null,
              executionStartedAtMs: null
            }));
            getQueryViewStateStore().setPanelSelectedOutput(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
            setExecutionPrimaryOverride(targetFileId, null);
          }
        });

        activeExecutionByFileIdRef.current.set(targetFileId, { executionId, unsubscribe });
      } catch (error) {
        activeExecutionByFileIdRef.current.delete(targetFileId);
        executionAnchorByFileIdRef.current.delete(targetFileId);
        securityRetryCountByFileIdRef.current.delete(targetFileId);
        updateOutputContextForFile(targetFileId, () => ({
          ...IDLE_OUTPUT_CONTEXT,
          state: "failed",
          error: {
            code: "EXECUTE_ERROR",
            message: error instanceof Error ? error.message : String(error)
          },
          executionStartedAtMs: null
        }));
        getQueryViewStateStore().setPanelSelectedOutput(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
        setExecutionPrimaryOverride(targetFileId, null);
      }
    };

    void run();
  }, [file?.fileId, setExecutionPrimaryOverride, updateOutputContextForFile]);

  const handleCancel = useCallback(() => {
    const targetFileId = file?.fileId;
    if (!targetFileId) return;

    const execution = activeExecutionByFileIdRef.current.get(targetFileId);
    if (!execution) return;

    execution.unsubscribe();
    void getQueryEngineService()
      .cancel(execution.executionId)
      .catch(() => {});
    activeExecutionByFileIdRef.current.delete(targetFileId);
    executionAnchorByFileIdRef.current.delete(targetFileId);
    securityRetryCountByFileIdRef.current.delete(targetFileId);
    updateOutputContextForFile(targetFileId, (prev) => ({
      ...prev,
      state: "cancelled",
      progress: null,
      executionStartedAtMs: null
    }));
    setExecutionPrimaryOverride(targetFileId, null);
  }, [file?.fileId, updateOutputContextForFile]);

  useEffect(() => {
    handleExecuteRef.current = handleExecute;
  }, [handleExecute]);

  useEffect(() => {
    handleCancelRef.current = handleCancel;
  }, [handleCancel]);

  useEffect(() => {
    const service = getQueryEngineService();
    const unsubExec = service.onExecuteRequest(() => handleExecuteRef.current());
    const unsubCancel = service.onCancelRequest(() => handleCancelRef.current());
    return () => {
      unsubExec();
      unsubCancel();
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const execution of activeExecutionByFileIdRef.current.values()) {
        execution.unsubscribe();
      }
      activeExecutionByFileIdRef.current.clear();
      executionAnchorByFileIdRef.current.clear();
      securityRetryCountByFileIdRef.current.clear();
    };
  }, []);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = Math.max(20, Math.min(80, ((ev.clientY - rect.top) / rect.height) * 100));
      setSplitPercent(pct);
    };

    const onUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="query-editor">
      <div className="query-editor-split" ref={splitContainerRef}>
        <div className="query-editor-text-pane" style={{ flexBasis: `${splitPercent}%` }}>
          <TextEditorComponent
            file={file}
            registry={queryTextRegistry}
            editorRegistryHost={editorRegistryHost}
            outlineRegistry={outlineRegistry}
            editorId="core.queryengine"
            openContextMenuOnModifierClick
          />
        </div>

        <div className="query-editor-divider" onMouseDown={handleDividerMouseDown} />

        <div className="query-editor-output-pane">
          <OutputPanel
            context={outputContext}
            selectedPrimaryId={selectedPrimaryId}
            onSelectPrimary={(id) => {
              const fileId = file?.fileId;
              if (fileId) {
                executionPrimaryOverrideByFileIdRef.current.delete(fileId);
                getQueryViewStateStore().setPanelSelectedOutput(fileId, id);
              }
              setSelectedPrimaryId(id);
            }}
            onExportOpen={(path) => void window.appShell.openPath(path)}
          />
        </div>
      </div>
    </div>
  );
}
