import React, { useState, useEffect, useCallback, useMemo } from "react";
import type { SettingDefinition } from "@queryeer/api/settings/SettingsExtension";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { ContextValues } from "./context-values";
import { getFilesRegistry } from "./files-registry-accessor";
import { getCommandContext, subscribeCommandContext } from "./command-context-accessor";
import { inflateDottedKeys } from "../../renderer/shell/context-value-flatten";
import { WhenExpressionEditor } from "./WhenExpressionEditor";
import { getExpressionRuntime } from "../core.expressions/runtime";
import "./expression-tester.css";

void React;

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function buildMergedContext(file: FileEntity | undefined, liveCtx: ContextValues): ContextValues {
  const base = file
    ? {
        ...liveCtx,
        hasActiveFile: true,
        activeFile: {
          fileId: file.fileId,
          uri: file.uri,
          mimeType: file.mimeType,
          metadata: inflateDottedKeys(file.metadata ?? {}),
          engineBinding: file.engineBinding,
        }
      }
    : liveCtx;

  // Add sample table action context so it's visible in the Playground
  return {
    ...base,
    tableData: {
      rows: [],
      columns: [] as { name: string; type: string }[],
      primaryRowIndex: 0,
      selectedRowIndexes: [],
      selectedColumnIndexes: [],
    },
    tableSelection: {
      hasSelection: false,
      selectedCellCount: 0,
      selectedRowCount: 0,
      selectedColumnCount: 0,
      isSingleColumnSelection: false,
      isSingleRowSelection: false,
      columns: [] as { name: string; type: string }[],
      columnNames: [] as string[],
    },
  };
}

function buildExpressionContext(_file: FileEntity | undefined, mergedContext: ContextValues): Record<string, unknown> {
  return mergedContext as Record<string, unknown>;
}

function getFileKeys(_file: FileEntity): Set<string> {
  return new Set<string>(["activeFile", "hasActiveFile"]);
}

// ---------------------------------------------------------------------------
// ExpressionTesterRenderer
// ---------------------------------------------------------------------------

type Props = {
  definition: SettingDefinition;
  value: unknown;
  setValue: (next: unknown) => void;
  readonly: boolean;
};

export function ExpressionTesterRenderer(_props: Props): JSX.Element {
  const [selectedFileId, setSelectedFileId] = useState<string>("");
  const [expression, setExpression] = useState<string>("");
  const [template, setTemplate] = useState<string>("${activeFile.mimeType}");
  const [mode, setMode] = useState<"when" | "template">("when");
  const [liveContext, setLiveContext] = useState<ContextValues>({});
  const [evalResult, setEvalResult] = useState<
    | { kind: "empty" }
    | { kind: "match"; output?: string }
    | { kind: "no-match" }
    | { kind: "error"; message: string }
  >({ kind: "empty" });
  const [showContextPopup, setShowContextPopup] = useState(false);

  const refreshContext = useCallback(() => {
    setLiveContext(getCommandContext());
  }, []);

  useEffect(() => {
    refreshContext();
    return subscribeCommandContext(refreshContext);
  }, [refreshContext]);

  const files = getFilesRegistry()?.listFiles() ?? [];

  // If previously selected file was closed, reset selection
  useEffect(() => {
    if (selectedFileId && !files.some((f) => f.fileId === selectedFileId)) {
      setSelectedFileId("");
    }
  }, [files, selectedFileId]);

  const selectedFile = useMemo(() => files.find((f) => f.fileId === selectedFileId), [files, selectedFileId]);
  const mergedContext = useMemo(() => buildMergedContext(selectedFile, liveContext), [selectedFile, liveContext]);
  const expressionContext = useMemo(() => buildExpressionContext(selectedFile, mergedContext), [selectedFile, mergedContext]);

  // Partition context keys into file-sourced vs live
  const fileKeys = selectedFile ? getFileKeys(selectedFile) : new Set<string>();
  const fileRows: Array<[string, ContextValues[string]]> = [];
  const liveRows: Array<[string, ContextValues[string]]> = [];

  for (const [k, v] of Object.entries(mergedContext)) {
    if (fileKeys.has(k)) {
      fileRows.push([k, v]);
    } else {
      liveRows.push([k, v]);
    }
  }
  const contextJson = JSON.stringify(expressionContext, null, 2);
  const fileContextJson = JSON.stringify(Object.fromEntries(fileRows), null, 2);
  const runtimeContextJson = JSON.stringify(Object.fromEntries(liveRows), null, 2);
  const groupedContextText = [
    "── From selected file ──",
    fileRows.length > 0 ? fileContextJson : "{}",
    "",
    "── Editor / runtime ──",
    liveRows.length > 0 ? runtimeContextJson : "{}",
    "",
    "── Merged context ──",
    contextJson
  ].join("\n");

  useEffect(() => {
    let cancelled = false;
    const runtime = getExpressionRuntime();
    void (async () => {
      if (mode === "when") {
        const expr = expression.trim();
        if (!expr) {
          if (!cancelled) setEvalResult({ kind: "empty" });
          return;
        }
        try {
          const result = await runtime.evaluateBoolean(expr, expressionContext, {
            mode: "when",
            source: "settings.expressionTester.when",
          });
          if (!cancelled) setEvalResult(result ? { kind: "match" } : { kind: "no-match" });
        } catch (e) {
          if (!cancelled) setEvalResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      const tpl = template.trim();
      if (!tpl) {
        if (!cancelled) setEvalResult({ kind: "empty" });
        return;
      }
      try {
        const output = await runtime.renderTemplate(tpl, expressionContext, {
          mode: "template",
          source: "settings.expressionTester.template",
        });
        if (!cancelled) setEvalResult({ kind: "match", output });
      } catch (e) {
        if (!cancelled) setEvalResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [expression, expressionContext, mode, template]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedFileId(e.target.value);
  }, []);

  return (
    <div className="expr-tester">
      {files.length === 0 ? (
        <div className="expr-tester-no-files">No files are currently open.</div>
      ) : (
        <>
          <div className="expr-tester-toolbar">
            <select className="expr-tester-file-select" value={mode} onChange={(e) => setMode(e.target.value as "when" | "template") }>
              <option value="when">When Expression</option>
              <option value="template">Template</option>
            </select>
            <select
              className="expr-tester-file-select"
              value={selectedFileId}
              onChange={handleFileChange}
            >
              <option value="">(no file selected)</option>
              {files.map((f) => (
                <option key={f.fileId} value={f.fileId}>
                  {f.uri}
                </option>
              ))}
            </select>
          </div>

          <div className="expr-tester-context-toolbar">
            <button
              type="button"
              className="expr-tester-context-open"
              onClick={() => setShowContextPopup(true)}
            >
              Open Context
            </button>
          </div>
        </>
      )}

      <div>
        <div className="expr-tester-section-label" style={{ marginBottom: 4 }}>
          {mode === "when" ? "Expression" : "Template"}
        </div>
        <WhenExpressionEditor
          value={mode === "when" ? expression : template}
          onChange={mode === "when" ? setExpression : setTemplate}
          height={mode === "when" ? 120 : 160}
          wordWrap={mode === "template"}
        />
      </div>

      {evalResult.kind !== "empty" && (
        <div className={`expr-tester-result ${evalResult.kind === "match" ? "match" : evalResult.kind === "no-match" ? "no-match" : "error"}`}>
          {evalResult.kind === "match" && (evalResult.output !== undefined ? `✓ ${evalResult.output}` : "✓ match")}
          {evalResult.kind === "no-match" && "✗ no match"}
          {evalResult.kind === "error" && `⚠ ${evalResult.message}`}
        </div>
      )}

      {showContextPopup && (
        <div className="expr-tester-context-modal-backdrop" onClick={() => setShowContextPopup(false)}>
          <div className="expr-tester-context-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expr-tester-context-modal-header">
              <span>Context JSON</span>
              <button
                type="button"
                className="expr-tester-context-close"
                onClick={() => setShowContextPopup(false)}
              >
                Close
              </button>
            </div>
            <textarea
              className="expr-tester-context-modal-text"
              value={groupedContextText}
              readOnly
            />
          </div>
        </div>
      )}
    </div>
  );
}
