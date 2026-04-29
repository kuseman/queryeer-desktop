import React, { useState, useEffect, useRef, useCallback } from "react";
import { TextEditorComponent } from "../core.editor/TextEditor/TextEditorComponent";
import { OutputPanel } from "./output/OutputPanel";
import type { OutputContext, ResultSet, ColumnType } from "../../contracts/extensions/OutputExtension";
import { IDLE_OUTPUT_CONTEXT, DEFAULT_OUTPUT_LIMITS } from "../../contracts/extensions/OutputExtension";
import { getQueryEngineService } from "./QueryEngineService";
import { getOutputRegistry } from "./output/OutputRegistry";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";

type Props = {
  file?: FileEntity;
};

type ActiveExecution = {
  executionId: string;
  unsubscribe: () => void;
};

const OUTPUT_CONTEXT_KEY = defineStateKey<OutputContext>("core.queryengine.outputContext");
const SELECTED_PRIMARY_KEY = defineStateKey<string>("core.queryengine.selectedPrimary");
const TEXT_OUTPUT_PRIMARY_ID = "core.queryengine.output.text";

export function QueryEditorComponent({ file }: Props): JSX.Element {
  const [outputContext, setOutputContext] = useState<OutputContext>(IDLE_OUTPUT_CONTEXT);
  const [splitPercent, setSplitPercent] = useState(60);
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<string | null>(null);

  const activeExecutionByFileIdRef = useRef(new Map<string, ActiveExecution>());
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
    setOutputContext(reg.get(fileId, OUTPUT_CONTEXT_KEY) ?? IDLE_OUTPUT_CONTEXT);
    const override = executionPrimaryOverrideByFileIdRef.current.get(fileId);
    setSelectedPrimaryId(override ?? reg.get(fileId, SELECTED_PRIMARY_KEY) ?? null);
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
      const manual = getFileStateRegistry().get(targetFileId, SELECTED_PRIMARY_KEY) ?? null;
      setSelectedPrimaryId(outputId ?? manual);
    }
  }, []);

  const handleSelectPrimary = useCallback((id: string) => {
    const fileId = fileIdRef.current;
    if (fileId) {
      getFileStateRegistry().set(fileId, SELECTED_PRIMARY_KEY, id);
    }
    setSelectedPrimaryId(id);
    getOutputRegistry().setSelectedPrimary(id);
  }, []);

  const handleExecute = useCallback(() => {
    const run = async () => {
      const targetFileId = file?.fileId;
      if (!targetFileId) return;

      // Cancel any existing execution for this file before starting a new one
      const existingExecution = activeExecutionByFileIdRef.current.get(targetFileId);
      if (existingExecution) {
        existingExecution.unsubscribe();
        await getQueryEngineService().cancel(existingExecution.executionId).catch(() => {});
        activeExecutionByFileIdRef.current.delete(targetFileId);
      }

      const editor = queryTextRegistry.getActiveEditor();
      if (!editor) return;

      const text = editor.getSelectedText() ?? editor.getContent();
      if (!text.trim()) return;

      setExecutionPrimaryOverride(targetFileId, null);

      updateOutputContextForFile(targetFileId, () => ({ ...IDLE_OUTPUT_CONTEXT, fileId: targetFileId, state: "running" }));

      try {
        const service = getQueryEngineService();
        const executionId = await service.execute({ fileId: targetFileId, text });

        const unsubscribe = service.subscribe(executionId, (event) => {
          if (event.method === "query.progress") {
            const p = event.params as { percent?: number; message?: string };
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              progress: { percent: p.percent, message: p.message }
            }));
          } else if (event.method === "query.chunkStart") {
            const p = event.params as { resultSetIndex: number; schema: { columns: Array<{ name: string; type: ColumnType }> } };
            updateOutputContextForFile(targetFileId, (prev) => {
              if (prev.resultSets.some((rs) => rs.resultSetIndex === p.resultSetIndex)) return prev;
              return {
                ...prev,
                resultSets: [
                  ...prev.resultSets,
                  { resultSetIndex: p.resultSetIndex, schema: p.schema, rows: [], rowLimitExceeded: false }
                ]
              };
            });
          } else if (event.method === "query.chunkRows") {
            const p = event.params as { resultSetIndex: number; rows: unknown[][] };
            const registry = getOutputRegistry();

            // Notify the primary contributor before updating state so Ag-Grid can
            // call applyTransaction() incrementally rather than diffing the full rows array.
            registry.notifyChunkRows({ resultSetIndex: p.resultSetIndex, rows: p.rows });

            // Check if this result set is already over the limit
            const currentCtx = getFileStateRegistry().get(targetFileId, OUTPUT_CONTEXT_KEY) ?? IDLE_OUTPUT_CONTEXT;
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
              return { ...prev, resultSets: sets };
            });
          } else if (event.method === "query.completed") {
            const p = event.params as { metrics?: { durationMs?: number; rowCount?: number }; features?: string[] };
            activeExecutionByFileIdRef.current.delete(targetFileId);
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "completed",
              metrics: p.metrics ?? null,
              features: p.features ?? ["rows"],
              progress: null
            }));

            const ctxAfterComplete = getFileStateRegistry().get(targetFileId, OUTPUT_CONTEXT_KEY) ?? IDLE_OUTPUT_CONTEXT;
            const hasRows = ctxAfterComplete.resultSets.some((rs) => rs.rows.length > 0);
            setExecutionPrimaryOverride(targetFileId, hasRows ? null : TEXT_OUTPUT_PRIMARY_ID);

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
          } else if (event.method === "query.failed") {
            const p = event.params as { error?: { code: string; message: string } };
            activeExecutionByFileIdRef.current.delete(targetFileId);
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "failed",
              error: p.error ?? { code: "UNKNOWN", message: "Query failed" },
              progress: null
            }));
            setExecutionPrimaryOverride(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
          }
        });

        activeExecutionByFileIdRef.current.set(targetFileId, { executionId, unsubscribe });
      } catch (error) {
        activeExecutionByFileIdRef.current.delete(targetFileId);
        updateOutputContextForFile(targetFileId, () => ({
          ...IDLE_OUTPUT_CONTEXT,
          state: "failed",
          error: {
            code: "EXECUTE_ERROR",
            message: error instanceof Error ? error.message : String(error)
          }
        }));
        setExecutionPrimaryOverride(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
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
    updateOutputContextForFile(targetFileId, (prev) => ({ ...prev, state: "cancelled", progress: null }));
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
          <TextEditorComponent file={file} registry={queryTextRegistry} />
        </div>

        <div className="query-editor-divider" onMouseDown={handleDividerMouseDown} />

        <div className="query-editor-output-pane">
          <OutputPanel
            context={outputContext}
            selectedPrimaryId={selectedPrimaryId}
            onSelectPrimary={handleSelectPrimary}
            onExportOpen={(path) => void window.appShell.openPath(path)}
          />
        </div>
      </div>
    </div>
  );
}
