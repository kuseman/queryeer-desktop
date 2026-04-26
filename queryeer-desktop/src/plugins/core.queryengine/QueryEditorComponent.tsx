import React, { useState, useEffect, useRef, useCallback } from "react";
import { TextEditorComponent } from "../core.editor/TextEditor/TextEditorComponent";
import { OutputPanel } from "./output/OutputPanel";
import type { OutputContext } from "./output/OutputRegistry";
import { getQueryEngineService } from "./QueryEngineService";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import type { FileEntity } from "../../contracts/files/FileEntity";

type Props = {
  file?: FileEntity;
};

const IDLE_CONTEXT: OutputContext = {
  state: "idle",
  schema: null,
  rows: [],
  metrics: null,
  error: null,
  progress: null
};

type ActiveExecution = {
  executionId: string;
  unsubscribe: () => void;
};

export function QueryEditorComponent({ file }: Props): JSX.Element {
  const [outputContext, setOutputContext] = useState<OutputContext>(IDLE_CONTEXT);
  const [splitPercent, setSplitPercent] = useState(60);

  const outputByFileIdRef = useRef(new Map<string, OutputContext>());
  const activeExecutionByFileIdRef = useRef(new Map<string, ActiveExecution>());
  const handleExecuteRef = useRef<() => void>(() => {});
  const handleCancelRef = useRef<() => void>(() => {});
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const fileIdRef = useRef(file?.fileId);
  fileIdRef.current = file?.fileId;

  // Restore per-file execution context on tab switch
  useEffect(() => {
    const fileId = file?.fileId;
    if (!fileId) {
      setOutputContext(IDLE_CONTEXT);
      return;
    }
    setOutputContext(outputByFileIdRef.current.get(fileId) ?? IDLE_CONTEXT);
  }, [file?.fileId]);

  const updateOutputContextForFile = useCallback(
    (targetFileId: string, updater: (prev: OutputContext) => OutputContext) => {
      const prevForFile = outputByFileIdRef.current.get(targetFileId) ?? IDLE_CONTEXT;
      const next = updater(prevForFile);
      outputByFileIdRef.current.set(targetFileId, next);
      if (fileIdRef.current === targetFileId) {
        setOutputContext(next);
      }
    },
    []
  );

  const handleExecute = useCallback(() => {
    const run = async () => {
      const targetFileId = file?.fileId;
      if (!targetFileId) return;

      // Cancel existing execution for same file before starting a new one
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

      // Local mutable accumulators shared by all event callbacks for this execution
      let accSchema: OutputContext["schema"] = null;
      const accRows: unknown[][] = [];

      updateOutputContextForFile(targetFileId, () => ({ ...IDLE_CONTEXT, state: "running" }));

      try {
        const service = getQueryEngineService();
        const executionId = await service.execute({
          fileId: targetFileId,
          text
        });

        const unsubscribe = service.subscribe(executionId, (event) => {
          if (event.method === "query.progress") {
            const p = event.params as { percent?: number; message?: string };
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              progress: { percent: p.percent, message: p.message }
            }));
          } else if (event.method === "query.chunkStart") {
            const p = event.params as { schema: { columns: Array<{ name: string; type: string }> } };
            accSchema = p.schema;
            updateOutputContextForFile(targetFileId, (prev) => ({ ...prev, schema: accSchema }));
          } else if (event.method === "query.chunkRows") {
            const p = event.params as { rows: unknown[][] };
            accRows.push(...p.rows);
            updateOutputContextForFile(targetFileId, (prev) => ({ ...prev, rows: [...accRows] }));
          } else if (event.method === "query.completed") {
            const p = event.params as { metrics?: { durationMs?: number; rowCount?: number } };
            activeExecutionByFileIdRef.current.delete(targetFileId);
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "completed",
              metrics: p.metrics ?? null,
              progress: null
            }));
          } else if (event.method === "query.failed") {
            const p = event.params as { error?: { code: string; message: string } };
            activeExecutionByFileIdRef.current.delete(targetFileId);
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "failed",
              error: p.error ?? { code: "UNKNOWN", message: "Query failed" },
              progress: null
            }));
          }
        });

        activeExecutionByFileIdRef.current.set(targetFileId, { executionId, unsubscribe });
      } catch (error) {
        activeExecutionByFileIdRef.current.delete(targetFileId);
        updateOutputContextForFile(targetFileId, () => ({
          ...IDLE_CONTEXT,
          state: "failed",
          error: {
            code: "EXECUTE_ERROR",
            message: error instanceof Error ? error.message : String(error)
          }
        }));
      }
    };

    void run();
  }, [file?.fileId, updateOutputContextForFile]);

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

  // Keep refs in sync with latest handler instances
  useEffect(() => {
    handleExecuteRef.current = handleExecute;
  }, [handleExecute]);

  useEffect(() => {
    handleCancelRef.current = handleCancel;
  }, [handleCancel]);

  // Subscribe once to service requests triggered by keybindings/commands
  useEffect(() => {
    const service = getQueryEngineService();
    const unsubExec = service.onExecuteRequest(() => handleExecuteRef.current());
    const unsubCancel = service.onCancelRequest(() => handleCancelRef.current());
    return () => {
      unsubExec();
      unsubCancel();
    };
  }, []);

  // Cleanup active execution on unmount
  useEffect(() => {
    return () => {
      for (const execution of activeExecutionByFileIdRef.current.values()) {
        execution.unsubscribe();
      }
      activeExecutionByFileIdRef.current.clear();
    };
  }, []);

  // Draggable divider between text and output panes
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

  const isRunning = outputContext.state === "running";

  return (
    <div className="query-editor">
      <div className="query-editor-toolbar">
        <button
          className="query-editor-btn query-editor-btn-run"
          onClick={handleExecute}
          disabled={isRunning}
          title="Execute (F5)"
        >
          ▶ Run
        </button>
        <button
          className="query-editor-btn query-editor-btn-stop"
          onClick={handleCancel}
          disabled={!isRunning}
          title="Cancel"
        >
          ■ Stop
        </button>
        <div className="query-editor-status">
          {isRunning && outputContext.progress?.message && (
            <span className="query-editor-status-running">
              {outputContext.progress.message}
            </span>
          )}
          {outputContext.state === "completed" && outputContext.metrics && (
            <span className="query-editor-status-ok">
              ✓ {outputContext.metrics.rowCount ?? 0} rows · {outputContext.metrics.durationMs ?? 0}ms
            </span>
          )}
          {outputContext.state === "failed" && outputContext.error && (
            <span className="query-editor-status-error">✗ {outputContext.error.code}</span>
          )}
          {outputContext.state === "cancelled" && (
            <span className="query-editor-status-cancelled">Cancelled</span>
          )}
        </div>
      </div>

      <div className="query-editor-split" ref={splitContainerRef}>
        <div className="query-editor-text-pane" style={{ flexBasis: `${splitPercent}%` }}>
          <TextEditorComponent file={file} registry={queryTextRegistry} />
        </div>

        <div className="query-editor-divider" onMouseDown={handleDividerMouseDown} />

        <div className="query-editor-output-pane">
          <OutputPanel context={outputContext} />
        </div>
      </div>
    </div>
  );
}
