import React, { useState, useEffect, useRef, useCallback } from "react";
import { TextEditorComponent } from "../core.editor/texteditor/TextEditorComponent";
import { OutputPanel } from "./output/OutputPanel";
import { QueryEditorStatusBar } from "./output/QueryEditorStatusBar";
import type { OutputContext, OutputMessage, ResultSet, ColumnType, Column } from "@queryeer/api/queryengine/OutputExtension";
import { IDLE_OUTPUT_CONTEXT } from "@queryeer/api/queryengine/OutputExtension";
import type { ExecuteRequestOptions } from "@queryeer/api/queryengine/QueryEngineTypes.js";
import type { QueryResultCell } from "@queryeer/api/backend/Types.js";
import { getQueryEngineService } from "./QueryEngineService";
import { resolveOutputMaxRows } from "./output-limits";
import { getOutputRegistry } from "./output/OutputRegistry";
import { getQueryOutputFormatRegistry } from "./QueryOutputFormatRegistry";
import { queryTextRegistry } from "./QueryTextEditorRegistry";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { defineStateKey } from "@queryeer/api/files/FileStateRegistry";
import { getQueryViewStateStore, TEXT_OUTPUT_PRIMARY_ID } from "./QueryViewStateStore";
import { toQueryOutputSessionId } from "./query-session";
import { getCoreSecurityService } from "../core.security/service";
import type { EditorRegistryHost } from "@queryeer/api/editor/EditorCapability";
import type { OutlineRegistry } from "@queryeer/api/extensions/OutlineExtension";
import { QUERY_PLAN_OUTPUT_ID as PLAN_OUTPUT_ID } from "./query-plan/constants";

type Props = {
  file?: FileEntity;
  editorRegistryHost?: EditorRegistryHost;
  outlineRegistry?: OutlineRegistry;
  editorInstanceId?: string;
  editorGroupId?: string;
  isActiveEditorGroup?: boolean;
};

type ActiveExecution = {
  executionId: string;
  unsubscribe: () => void;
};

type QueryEditorFileRuntimeState = {
  activeExecution?: ActiveExecution;
  pendingExecutionStart?: boolean;
  cancelPendingExecution?: boolean;
  executionAnchor?: ExecutionAnchor;
  securityRetryCount?: number;
  executionPrimaryOverride?: string;
  panelSelectedPrimaryId?: string;
  fileOutputPath?: string;
  fileOutputSchema?: Map<number, { columns: Column[] }>;
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

type OutputContextBySession = Record<string, OutputContext>;

const OUTPUT_CONTEXT_KEY = defineStateKey<OutputContextBySession>("core.queryengine.outputContextBySession");
const FILE_OUTPUT_PRIMARY_ID = "core.queryengine.output.file";
const TABLE_OUTPUT_PRIMARY_ID = "core.queryengine.output.table";
const DEFAULT_OUTPUT_SESSION_KEY = "__default__";

function toOutputSessionStorageKey(outputSessionId: string | undefined): string {
  return outputSessionId ?? DEFAULT_OUTPUT_SESSION_KEY;
}

export function QueryEditorComponent({ file, editorRegistryHost, outlineRegistry, editorInstanceId, editorGroupId, isActiveEditorGroup }: Props): JSX.Element {
  const outputSessionId = toQueryOutputSessionId(editorGroupId, editorInstanceId ?? file?.fileId);
  const outputSessionStorageKey = toOutputSessionStorageKey(outputSessionId);
  const [outputContext, setOutputContext] = useState<OutputContext>(IDLE_OUTPUT_CONTEXT);
  const [splitPercent, setSplitPercent] = useState(60);
  const [outputCollapsed, setOutputCollapsed] = useState(false);
  const [selectedPrimaryId, setSelectedPrimaryId] = useState<string | null>(null);

  const runtimeStateByFileIdRef = useRef(new Map<string, QueryEditorFileRuntimeState>());
  const handleExecuteRef = useRef<(retryExecuteOptions?: ExecuteRequestOptions | null) => void>(() => {});
  const handleCancelRef = useRef<() => void>(() => {});
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const executingRef = useRef(false);
  const fileIdRef = useRef(file?.fileId);
  const outputSessionIdRef = useRef(outputSessionId);
  const outputSessionStorageKeyRef = useRef(outputSessionStorageKey);
  const editorGroupIdRef = useRef(editorGroupId);
  const isActiveEditorGroupRef = useRef<boolean>(isActiveEditorGroup !== false);
  fileIdRef.current = file?.fileId;
  outputSessionIdRef.current = outputSessionId;
  outputSessionStorageKeyRef.current = outputSessionStorageKey;
  editorGroupIdRef.current = editorGroupId;
  isActiveEditorGroupRef.current = isActiveEditorGroup !== false;

  const getRuntimeState = (targetFileId: string): QueryEditorFileRuntimeState => {
    let state = runtimeStateByFileIdRef.current.get(targetFileId);
    if (!state) {
      state = {};
      runtimeStateByFileIdRef.current.set(targetFileId, state);
    }
    return state;
  };

  const peekRuntimeState = (targetFileId: string): QueryEditorFileRuntimeState | undefined => {
    return runtimeStateByFileIdRef.current.get(targetFileId);
  };

  const pruneRuntimeState = (targetFileId: string): void => {
    const state = runtimeStateByFileIdRef.current.get(targetFileId);
    if (!state) {
      return;
    }
    const hasAnyState = state.activeExecution !== undefined
      || state.pendingExecutionStart === true
      || state.cancelPendingExecution === true
      || state.executionAnchor !== undefined
      || state.securityRetryCount !== undefined
      || state.executionPrimaryOverride !== undefined
      || state.panelSelectedPrimaryId !== undefined
      || state.fileOutputPath !== undefined
      || state.fileOutputSchema !== undefined;

    if (!hasAnyState) {
      runtimeStateByFileIdRef.current.delete(targetFileId);
    }
  };

  const clearRuntimeExecutionState = (targetFileId: string): void => {
    const state = runtimeStateByFileIdRef.current.get(targetFileId);
    if (!state) {
      return;
    }
    state.activeExecution = undefined;
    state.pendingExecutionStart = undefined;
    state.cancelPendingExecution = undefined;
    state.executionAnchor = undefined;
    state.securityRetryCount = undefined;
    state.fileOutputPath = undefined;
    state.fileOutputSchema = undefined;
    pruneRuntimeState(targetFileId);
  };

  const resolveStoredOutputContextForFile = useCallback((targetFileId: string): { context: OutputContext; hasStored: boolean } => {
    const bySession = getFileStateRegistry().get(targetFileId, OUTPUT_CONTEXT_KEY) ?? {};
    const sessionKey = outputSessionStorageKeyRef.current;
    const sessionContext = bySession[sessionKey];
    const fallbackContext = sessionKey !== DEFAULT_OUTPUT_SESSION_KEY
      ? bySession[DEFAULT_OUTPUT_SESSION_KEY]
      : undefined;
    const source = sessionContext ?? fallbackContext;
    if (!source) {
      return {
        hasStored: false,
        context: {
          ...IDLE_OUTPUT_CONTEXT,
          fileId: targetFileId,
          outputSessionId: outputSessionIdRef.current
        }
      };
    }
    return {
      hasStored: true,
      context: {
      ...IDLE_OUTPUT_CONTEXT,
      ...source,
      artifacts: source.artifacts ?? [],
      fileId: targetFileId,
      outputSessionId: outputSessionIdRef.current
      }
    };
  }, []);

  const readOutputContextForFile = useCallback((targetFileId: string): OutputContext => {
    return resolveStoredOutputContextForFile(targetFileId).context;
  }, [resolveStoredOutputContextForFile]);

  const writeOutputContextForFile = useCallback((targetFileId: string, next: OutputContext): void => {
    const reg = getFileStateRegistry();
    const bySession = reg.get(targetFileId, OUTPUT_CONTEXT_KEY) ?? {};
    const normalized: OutputContext = {
      ...IDLE_OUTPUT_CONTEXT,
      ...next,
      artifacts: next.artifacts ?? [],
      fileId: targetFileId,
      outputSessionId: outputSessionIdRef.current
    };
    reg.set(targetFileId, OUTPUT_CONTEXT_KEY, {
      ...bySession,
      [outputSessionStorageKeyRef.current]: normalized
    });
  }, []);

  const setPanelSelectedPrimary = useCallback((targetFileId: string, outputId: string | null) => {
    const runtimeState = getRuntimeState(targetFileId);
    if (outputId === null) {
      runtimeState.panelSelectedPrimaryId = undefined;
    } else {
      runtimeState.panelSelectedPrimaryId = outputId;
    }
    pruneRuntimeState(targetFileId);

    const selected = runtimeState.executionPrimaryOverride ?? outputId ?? null;
    if (fileIdRef.current === targetFileId) {
      setSelectedPrimaryId(selected);
    }
  }, []);

  // Restore per-file context and primary selection on tab switch
  useEffect(() => {
    const fileId = file?.fileId;
    if (!fileId) {
      setOutputContext(IDLE_OUTPUT_CONTEXT);
      setSelectedPrimaryId(null);
      return;
    }
    const queryViewState = getQueryViewStateStore().read(fileId, outputSessionIdRef.current);
    const restored = resolveStoredOutputContextForFile(fileId);
    const restoredContext = restored.context;
    const defaultRowsTargetPrimaryId = restored.hasStored
      ? restoredContext.rowsTargetPrimaryId
      : (queryViewState.executionTargetOutputId
        ?? getOutputRegistry().getSelectablePrimaryContributors()[0]?.id
        ?? restoredContext.rowsTargetPrimaryId
        ?? null);
    const nextContext: OutputContext = {
      ...restoredContext,
      fileId,
      outputSessionId,
      textOutputFormat: restored.hasStored
        ? restoredContext.textOutputFormat
        : (queryViewState.textOutputFormat ?? restoredContext.textOutputFormat ?? "plain"),
      rowsTargetPrimaryId: defaultRowsTargetPrimaryId
    };
    setOutputContext(nextContext);

    const runtimeState = peekRuntimeState(fileId);
    const nextSelected = runtimeState?.executionPrimaryOverride
      ?? runtimeState?.panelSelectedPrimaryId
      ?? queryViewState.panelActiveOutputId
      ?? defaultRowsTargetPrimaryId
      ?? null;
    setSelectedPrimaryId(nextSelected);
    setOutputCollapsed(queryViewState.outputPanelCollapsed ?? false);
  }, [file?.fileId, outputSessionId, resolveStoredOutputContextForFile]);

  useEffect(() => {
    if (!file?.fileId || isActiveEditorGroup === false) {
      return;
    }

    const raf = requestAnimationFrame(() => {
      editorRegistryHost?.getActiveEditor()?.focus?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [file?.fileId, isActiveEditorGroup, editorRegistryHost]);

  useEffect(() => {
    const fileId = file?.fileId;
    if (!fileId) {
      return;
    }
    return getQueryViewStateStore().subscribe(fileId, outputSessionIdRef.current, (state) => {
      if (state.outputPanelCollapsed !== undefined) {
        setOutputCollapsed(state.outputPanelCollapsed);
      }
    });
  }, [file?.fileId, outputSessionIdRef.current]);

  const updateOutputContextForFile = useCallback(
    (targetFileId: string, updater: (prev: OutputContext) => OutputContext) => {
      const prev = readOutputContextForFile(targetFileId);
      const next = updater(prev);
      writeOutputContextForFile(targetFileId, next);
      if (fileIdRef.current === targetFileId) {
        setOutputContext({
          ...IDLE_OUTPUT_CONTEXT,
          ...next,
          artifacts: next.artifacts ?? [],
          fileId: targetFileId,
          outputSessionId: outputSessionIdRef.current
        });
      }
    },
    [readOutputContextForFile, writeOutputContextForFile]
  );

  const setExecutionPrimaryOverride = useCallback((targetFileId: string, outputId: string | null) => {
    const runtimeState = getRuntimeState(targetFileId);
    if (outputId === null) {
      runtimeState.executionPrimaryOverride = undefined;
    } else {
      runtimeState.executionPrimaryOverride = outputId;
    }
    pruneRuntimeState(targetFileId);
    const fallback = runtimeState.panelSelectedPrimaryId
      ?? readOutputContextForFile(targetFileId).rowsTargetPrimaryId
      ?? null;
    const selected = outputId ?? fallback;
    if (fileIdRef.current === targetFileId) {
      setSelectedPrimaryId(selected);
    }
  }, [readOutputContextForFile]);

  const handleExecute = useCallback((retryExecuteOptions?: ExecuteRequestOptions | null) => {
    if (executingRef.current) {
      return;
    }
    executingRef.current = true;

    const run = async () => {
      const targetFileId = file?.fileId;
      if (!targetFileId) return;
      const runtimeState = getRuntimeState(targetFileId);
      if (runtimeState.securityRetryCount === undefined) {
        runtimeState.securityRetryCount = 0;
      }

      // Cancel any existing execution for this file before starting a new one
      const existingExecution = runtimeState.activeExecution;
      if (existingExecution) {
        existingExecution.unsubscribe();
        await getQueryEngineService().cancel(existingExecution.executionId).catch(() => {});
        runtimeState.activeExecution = undefined;
      }

      const executeOptions = retryExecuteOptions ?? getQueryEngineService().consumeExecuteOptions({
        fileId: targetFileId,
        targetOutputSessionId: outputSessionIdRef.current,
        targetEditorGroupId: editorGroupIdRef.current,
        isActiveEditorGroup: isActiveEditorGroupRef.current
      });
      if (!executeOptions && isActiveEditorGroupRef.current === false) {
        return;
      }

      const handle = isActiveEditorGroupRef.current
        ? editorRegistryHost?.getActiveEditor()
        : null;
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
      runtimeState.executionAnchor = anchor;

      const panelState = getQueryViewStateStore().read(targetFileId, outputSessionIdRef.current);
      const selectedFromToolbar = executeOptions?.outputIdOverride ?? panelState.executionTargetOutputId;
      const outputRegistry = getOutputRegistry();
      const selectablePrimaryIds = outputRegistry.getSelectablePrimaryContributors().map((output) => output.id);
      const isSelectedPrimary = selectedFromToolbar
        ? selectablePrimaryIds.includes(selectedFromToolbar)
        : false;
      const registrySelectedPrimaryId = outputRegistry.getSelectedPrimaryIdForSession(outputSessionIdRef.current);
      const fallbackPrimaryId = registrySelectedPrimaryId && selectablePrimaryIds.includes(registrySelectedPrimaryId)
        ? registrySelectedPrimaryId
        : (selectablePrimaryIds[0] ?? TEXT_OUTPUT_PRIMARY_ID);
      const targetPrimaryCandidate = isSelectedPrimary ? selectedFromToolbar : panelState.executionTargetOutputId;
      const targetPrimaryId = targetPrimaryCandidate && selectablePrimaryIds.includes(targetPrimaryCandidate)
        ? targetPrimaryCandidate
        : fallbackPrimaryId;
      const panelOutputId = executeOptions?.outputIdOverride ?? targetPrimaryId;

      const isFileOutput = targetPrimaryId === FILE_OUTPUT_PRIMARY_ID;
      runtimeState.fileOutputPath = undefined;
      runtimeState.fileOutputSchema = undefined;

      if (isFileOutput) {
        const format = panelState.textOutputFormat ?? "csv";
        const ext = format === "json" ? "json" : format === "csv" ? "csv" : "txt";
        const dialogResult = await window.appShell.showDialogSave({
          title: "Save Query Result",
          defaultPath: `query-result.${ext}`,
          filters: [
            { name: ext.toUpperCase(), extensions: [ext] },
            { name: "All Files", extensions: ["*"] }
          ]
        });
        if (dialogResult.canceled || !dialogResult.filePath) return;
        runtimeState.fileOutputPath = dialogResult.filePath;
        runtimeState.fileOutputSchema = new Map();
      }

      outputRegistry.notifyExecutionStart({ fileId: targetFileId, outputSessionId: outputSessionIdRef.current }, targetPrimaryId);
      setPanelSelectedPrimary(targetFileId, panelOutputId ?? null);
      setExecutionPrimaryOverride(targetFileId, panelOutputId ?? null);

      const persistedFormat = executeOptions?.formatOverride ?? getQueryViewStateStore().read(targetFileId, outputSessionIdRef.current).textOutputFormat;
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
        runtimeState.pendingExecutionStart = true;
        runtimeState.cancelPendingExecution = undefined;
        const executionId = await service.execute({
          fileId: targetFileId,
          text,
          targetOutputSessionId: executeOptions?.targetOutputSessionId ?? outputSessionIdRef.current,
          ...(executeOptions?.optionsOverride ? { options: executeOptions.optionsOverride } : {})
        });
        runtimeState.pendingExecutionStart = undefined;

        if (runtimeState.cancelPendingExecution === true) {
          runtimeState.cancelPendingExecution = undefined;
          void service.cancel(executionId).catch(() => {});
          clearRuntimeExecutionState(targetFileId);
          updateOutputContextForFile(targetFileId, (prev) => ({
            ...prev,
            state: "cancelled",
            progress: null,
            executionStartedAtMs: null
          }));
          setExecutionPrimaryOverride(targetFileId, null);
          return;
        }

        const unsubscribe = service.subscribe(executionId, (event) => {
          if (event.method === "queryengine.progress") {
            const p = event.params as { percent?: number; message?: string };
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              progress: { percent: p.percent, message: p.message }
            }));
          } else if (event.method === "queryengine.chunkStart") {
            const p = event.params as { resultSetIndex: number; schema: { columns: Array<{ name: string; type: ColumnType }>; metadata?: Record<string, string> } };
            // Preserve schema for file output export-stream reconstruction
            const schemas = runtimeState.fileOutputSchema;
            schemas?.set(p.resultSetIndex, { columns: p.schema.columns });

            // Pre-open the export stream for file output so it's ready before rows arrive.
            const startCtx = readOutputContextForFile(targetFileId);
            if (startCtx.rowsTargetPrimaryId === FILE_OUTPUT_PRIMARY_ID) {
              void window.appShell.openExportStream({ executionId, resultSetIndex: p.resultSetIndex });
            }

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
              rows: QueryResultCell[][];
              messages?: Array<{ severity: string; message: string; line?: number; column?: number }>;
            };
            const registry = getOutputRegistry();

            const currentCtx = readOutputContextForFile(targetFileId);
            const rowsTargetPrimaryId = currentCtx.rowsTargetPrimaryId;
            const isTableOutput = rowsTargetPrimaryId === TABLE_OUTPUT_PRIMARY_ID;
            const currentSet = currentCtx.resultSets.find((rs) => rs.resultSetIndex === p.resultSetIndex);

            // Handle output messages (info/warnings/errors from the engine)
            if (p.messages && p.messages.length > 0) {
              const executionAnchor = runtimeState.executionAnchor ?? { line: 1, column: 1 };
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

            // ---- File output: pipe ALL rows to the export stream, no in-memory accumulation ----
            if (rowsTargetPrimaryId === FILE_OUTPUT_PRIMARY_ID) {
              void window.appShell.appendExportChunk({
                executionId,
                resultSetIndex: p.resultSetIndex,
                rows: p.rows
              });
              updateOutputContextForFile(targetFileId, (prev) => ({
                ...prev,
                resultSets: prev.resultSets.map((rs) =>
                  rs.resultSetIndex === p.resultSetIndex
                    ? { ...rs, rowLimitExceeded: true, rows: [] }
                    : rs
                )
              }));
              return;
            }

            if (isTableOutput) {
              if (currentSet?.rowLimitExceeded) {
                void window.appShell.appendExportChunk({
                  executionId,
                  resultSetIndex: p.resultSetIndex,
                  rows: p.rows
                });
                return;
              }

              const maxRows = resolveOutputMaxRows();
              const previousRowCount = currentSet?.rowCount ?? currentSet?.rows.length ?? 0;
              const remainingRows = maxRows === -1 ? p.rows.length : Math.max(0, maxRows - previousRowCount);
              const retainedRows = remainingRows >= p.rows.length ? p.rows : p.rows.slice(0, remainingRows);
              if (retainedRows.length > 0) {
                registry.notifyChunkRows({
                  fileId: targetFileId,
                  outputSessionId: outputSessionIdRef.current,
                  resultSetIndex: p.resultSetIndex,
                  rows: retainedRows
                }, rowsTargetPrimaryId);
              }

              updateOutputContextForFile(targetFileId, (prev) => {
                const sets = prev.resultSets.map((rs): ResultSet => {
                  if (rs.resultSetIndex !== p.resultSetIndex) return rs;
                  const rowCount = (rs.rowCount ?? rs.rows.length) + retainedRows.length;
                  if (maxRows !== -1 && retainedRows.length < p.rows.length) {
                    void (async () => {
                      await window.appShell.openExportStream({ executionId, resultSetIndex: p.resultSetIndex });
                      await window.appShell.appendExportChunk({
                        executionId,
                        resultSetIndex: p.resultSetIndex,
                        rows: p.rows.slice(retainedRows.length)
                      });
                    })();
                    return { ...rs, rowCount, rowLimitExceeded: true };
                  }
                  return { ...rs, rowCount };
                });
                return {
                  ...prev,
                  resultSets: sets
                };
              });
              return;
            }

            // Notify the primary contributor before updating state so table-like outputs can
            // apply chunk updates incrementally rather than diffing a full rows array.
            registry.notifyChunkRows({
              fileId: targetFileId,
              outputSessionId: outputSessionIdRef.current,
              resultSetIndex: p.resultSetIndex,
              rows: p.rows
            }, rowsTargetPrimaryId);

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
              const maxRows = resolveOutputMaxRows();
              const sets = prev.resultSets.map((rs): ResultSet => {
                if (rs.resultSetIndex !== p.resultSetIndex) return rs;
                const combined = [...rs.rows, ...p.rows];
                if (maxRows !== -1 && combined.length >= maxRows) {
                  // Open the export stream for this result set (fire-and-forget; path resolved on completed)
                  void window.appShell.openExportStream({ executionId, resultSetIndex: p.resultSetIndex });
                  return { ...rs, rows: combined.slice(0, maxRows), rowLimitExceeded: true };
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
            runtimeState.activeExecution = undefined;
            runtimeState.securityRetryCount = undefined;
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "completed",
              metrics: p.metrics ?? null,
              features: p.features ?? ["rows"],
              artifacts,
              progress: null,
              executionStartedAtMs: null
            }));

            if (hasPlanGraphArtifact && runtimeState.fileOutputPath == null) {
              setPanelSelectedPrimary(targetFileId, PLAN_OUTPUT_ID);
              if (isActiveEditorGroupRef.current) {
                requestAnimationFrame(() => {
                  editorRegistryHost?.getActiveEditor()?.focus?.focus();
                });
              }
            }
            setExecutionPrimaryOverride(targetFileId, null);

            // Finalize any open export streams and patch exportPath back into the result set
            const ctx = readOutputContextForFile(targetFileId);
            const fileOutputPath = runtimeState.fileOutputPath;
            const schemas = runtimeState.fileOutputSchema;

            const isFileOutput = fileOutputPath != null;

            if (isFileOutput) {
              // File output: finalize all streams, merge all result sets → single formatted file
              void (async () => {
                try {
                  const limitSets = ctx.resultSets.filter((rs) => rs.rowLimitExceeded);
                  const finalized = await Promise.all(
                    limitSets.map(async (rs) => {
                      const { exportPath: tempPath } = await window.appShell.finalizeExportStream({
                        executionId, resultSetIndex: rs.resultSetIndex
                      });
                      const { content: ndjsonContent } = await window.appShell.readFile(tempPath);
                      const columns = schemas?.get(rs.resultSetIndex)?.columns ?? rs.schema.columns;
                      const rows = ndjsonContent
                        .trim()
                        .split("\n")
                        .filter(Boolean)
                        .map((line) => JSON.parse(line) as QueryResultCell[]);
                      return { resultSetIndex: rs.resultSetIndex, schema: { columns }, rows, rowLimitExceeded: false as const };
                    })
                  );

                  if (finalized.length > 0) {
                    const formatId = getQueryViewStateStore().read(targetFileId, outputSessionIdRef.current).textOutputFormat ?? "csv";
                    const formatter = getQueryOutputFormatRegistry().getFormatter(formatId);
                    if (!formatter) {
                      console.error(`[QueryEditor] No formatter found for '${formatId}'`);
                    } else {
                      const formatted = formatter.formatFile(finalized);
                      const targetUri = "file:///" + fileOutputPath.replace(/\\/g, "/");
                      await window.appShell.writeFile(targetUri, formatted);

                      updateOutputContextForFile(targetFileId, (prev) => ({
                        ...prev,
                        resultSets: prev.resultSets.map((s) => ({
                          ...s,
                          rowLimitExceeded: true,
                          exportPath: targetUri
                        }))
                      }));
                    }
                  }
                } catch (err) {
                  console.error("[QueryEditor] File output failed:", err);
                }
              })();
            } else {
              for (const rs of ctx.resultSets) {
                if (!rs.rowLimitExceeded) continue;
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

            // Clean up file output state
            clearRuntimeExecutionState(targetFileId);
          } else if (event.method === "queryengine.failed") {
            const p = event.params as {
              error?: { code: string; message: string; details?: Record<string, unknown> };
            };
            const executionAnchor = runtimeState.executionAnchor ?? { line: 1, column: 1 };
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
              const retryCount = runtimeState.securityRetryCount ?? 0;
              clearRuntimeExecutionState(targetFileId);
              updateOutputContextForFile(targetFileId, (prev) => ({
                ...prev,
                state: "failed",
                error: errorWithLocation,
                progress: null,
                executionStartedAtMs: null
              }));
              setExecutionPrimaryOverride(targetFileId, null);

              void (async () => {
                let accepted = false;
                const security = getCoreSecurityService();
                try {
                  accepted = security
                    ? await security.ensureUnlockedForSecretAccess({ interactive: true })
                    : false;
                } catch {
                  accepted = false;
                }

                if (accepted && retryCount < 1) {
                  const latestState = peekRuntimeState(targetFileId);
                  if (latestState?.activeExecution || latestState?.pendingExecutionStart === true) {
                    return;
                  }
                  const retryState = getRuntimeState(targetFileId);
                  retryState.securityRetryCount = retryCount + 1;
                  handleExecuteRef.current(executeOptions);
                  return;
                }

                setPanelSelectedPrimary(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
                setExecutionPrimaryOverride(targetFileId, null);
              })();
              return;
            }
            clearRuntimeExecutionState(targetFileId);
            updateOutputContextForFile(targetFileId, (prev) => ({
              ...prev,
              state: "failed",
              error: errorWithLocation ?? { code: "UNKNOWN", message: "Query failed" },
              progress: null,
              executionStartedAtMs: null
            }));
            setPanelSelectedPrimary(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
            setExecutionPrimaryOverride(targetFileId, null);
          }
        });

        runtimeState.activeExecution = { executionId, unsubscribe };
      } catch (error) {
        runtimeState.pendingExecutionStart = undefined;
        if (runtimeState.cancelPendingExecution === true) {
          runtimeState.cancelPendingExecution = undefined;
          clearRuntimeExecutionState(targetFileId);
          updateOutputContextForFile(targetFileId, (prev) => ({
            ...prev,
            state: "cancelled",
            progress: null,
            executionStartedAtMs: null
          }));
          setExecutionPrimaryOverride(targetFileId, null);
          return;
        }
        clearRuntimeExecutionState(targetFileId);
        updateOutputContextForFile(targetFileId, () => ({
          ...IDLE_OUTPUT_CONTEXT,
          state: "failed",
          error: {
            code: "EXECUTE_ERROR",
            message: error instanceof Error ? error.message : String(error)
          },
          executionStartedAtMs: null
        }));
        setPanelSelectedPrimary(targetFileId, TEXT_OUTPUT_PRIMARY_ID);
        setExecutionPrimaryOverride(targetFileId, null);
      }
    };

    run().finally(() => {
      executingRef.current = false;
    });
  }, [
    file?.fileId,
    setExecutionPrimaryOverride,
    setPanelSelectedPrimary,
    updateOutputContextForFile,
    editorRegistryHost,
    readOutputContextForFile
  ]);

  const handleCancel = useCallback(() => {
    const targetFileId = file?.fileId;
    if (!targetFileId) return;

    const runtimeState = getRuntimeState(targetFileId);

    const execution = runtimeState.activeExecution;
    if (!execution) {
      if (runtimeState.pendingExecutionStart === true) {
        runtimeState.cancelPendingExecution = true;
        updateOutputContextForFile(targetFileId, (prev) => ({
          ...prev,
          state: "cancelled",
          progress: null,
          executionStartedAtMs: null
        }));
        setExecutionPrimaryOverride(targetFileId, null);
      }
      return;
    }

    execution.unsubscribe();
    void getQueryEngineService()
      .cancel(execution.executionId)
      .catch(() => {});
    clearRuntimeExecutionState(targetFileId);
    updateOutputContextForFile(targetFileId, (prev) => ({
      ...prev,
      state: "cancelled",
      progress: null,
      executionStartedAtMs: null
    }));
    setExecutionPrimaryOverride(targetFileId, null);
  }, [file?.fileId, updateOutputContextForFile, setExecutionPrimaryOverride]);

  useEffect(() => {
    handleExecuteRef.current = handleExecute;
  }, [handleExecute]);

  useEffect(() => {
    handleCancelRef.current = handleCancel;
  }, [handleCancel]);

  useEffect(() => {
    const service = getQueryEngineService();

    // On mount, consume any pending execution options targeting this file
    const targetFileId = fileIdRef.current;
    if (targetFileId) {
      const pendingOptions = service.consumeExecuteOptions({
        fileId: targetFileId,
        targetOutputSessionId: outputSessionIdRef.current,
        targetEditorGroupId: editorGroupIdRef.current,
        isActiveEditorGroup: isActiveEditorGroupRef.current
      });
      if (pendingOptions) {
        handleExecuteRef.current(pendingOptions);
      }
    }

    const unsubExec = service.onExecuteRequest(() => {
      const pending = service.peekExecuteOptions();
      if (pending?.targetOutputSessionId && pending.targetOutputSessionId !== outputSessionIdRef.current) {
        return;
      }
      if (pending?.targetEditorGroupId && pending.targetEditorGroupId !== editorGroupIdRef.current) {
        return;
      }
      if (pending?.fileIdOverride && pending.fileIdOverride !== fileIdRef.current) {
        return;
      }
      if (!pending?.targetOutputSessionId && !pending?.targetEditorGroupId && isActiveEditorGroupRef.current === false) {
        return;
      }
      handleExecuteRef.current();
    });
    const unsubCancel = service.onCancelRequest(() => handleCancelRef.current());
    const unsubToggle = service.onToggleOutputPanelRequest(() => {
      if (isActiveEditorGroupRef.current === false) return;
      const targetFileIdInner = fileIdRef.current;
      if (!targetFileIdInner) return;
      const current = getQueryViewStateStore().read(targetFileIdInner, outputSessionIdRef.current).outputPanelCollapsed ?? false;
      getQueryViewStateStore().setOutputPanelCollapsed(targetFileIdInner, outputSessionIdRef.current, !current);
    });
    return () => {
      unsubExec();
      unsubCancel();
      unsubToggle();
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const state of runtimeStateByFileIdRef.current.values()) {
        const execution = state.activeExecution;
        if (!execution) {
          continue;
        }
        execution.unsubscribe();
      }
      runtimeStateByFileIdRef.current.clear();
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
    <div className={`query-editor${outputCollapsed ? " output-collapsed" : ""}`}>
      <div className="query-editor-split" ref={splitContainerRef}>
        <div className="query-editor-text-pane" style={{ flexBasis: outputCollapsed ? "100%" : `${splitPercent}%` }}>
          <TextEditorComponent
            file={file}
            registry={queryTextRegistry}
            editorRegistryHost={editorRegistryHost}
            outlineRegistry={outlineRegistry}
            editorId="core.queryengine"
            editorInstanceId={editorInstanceId}
            isActiveEditorGroup={isActiveEditorGroup}
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
                const runtimeState = peekRuntimeState(fileId);
                if (runtimeState) {
                  runtimeState.executionPrimaryOverride = undefined;
                  pruneRuntimeState(fileId);
                }
                setPanelSelectedPrimary(fileId, id);
              }
            }}
            onExportOpen={(path) => void window.appShell.openPath(path)}
            onExportShowInFolder={(path) => void window.appShell.showItemInFolder(path)}
          />
        </div>
      </div>
      <QueryEditorStatusBar outputContext={outputContext} file={file} />
    </div>
  );
}
