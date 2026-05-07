import React, { useState, useEffect, useCallback } from "react";
import type { SettingDefinition } from "../../contracts/extensions/SettingsExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { ContextValues } from "./when-evaluator";
import { getFilesRegistry } from "./files-registry-accessor";
import { getCommandContext, subscribeCommandContext } from "./command-context-accessor";
import { evaluateWhenExpression } from "./when-evaluator";
import { flattenContextObject } from "../../renderer/shell/context-value-flatten";
import { WhenExpressionEditor } from "./WhenExpressionEditor";
import "./expression-tester.css";

void React;

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function buildMergedContext(file: FileEntity | undefined, liveCtx: ContextValues): ContextValues {
  if (!file) return liveCtx;
  return {
    ...liveCtx,
    activeFileMimeType: file.mimeType,
    hasActiveFile: true,
    ...flattenContextObject("activeFileMetadata", file.metadata)
  };
}

function getFileKeys(file: FileEntity): Set<string> {
  const keys = new Set<string>(["activeFileMimeType", "hasActiveFile"]);
  const flat = flattenContextObject("activeFileMetadata", file.metadata);
  for (const k of Object.keys(flat)) {
    keys.add(k);
  }
  return keys;
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
  const [liveContext, setLiveContext] = useState<ContextValues>({});

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

  const selectedFile = files.find((f) => f.fileId === selectedFileId);
  const mergedContext = buildMergedContext(selectedFile, liveContext);

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

  // Evaluate the expression
  type EvalResult =
    | { kind: "empty" }
    | { kind: "match" }
    | { kind: "no-match" }
    | { kind: "error"; message: string };

  let evalResult: EvalResult = { kind: "empty" };
  if (expression.trim()) {
    try {
      const result = evaluateWhenExpression(expression, mergedContext);
      evalResult = result ? { kind: "match" } : { kind: "no-match" };
    } catch (e) {
      evalResult = { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  }

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

          <div className="expr-tester-context">
            <div className="expr-tester-context-header">Context</div>
            <div className="expr-tester-context-body">
              {selectedFile && fileRows.length > 0 && (
                <>
                  <div className="expr-tester-context-group-label">── From selected file ──</div>
                  {fileRows.map(([k, v]) => (
                    <div key={k} className="expr-tester-context-row">
                      <span className="expr-tester-context-key">{k}</span>
                      <span className="expr-tester-context-value">{String(v ?? "")}</span>
                    </div>
                  ))}
                </>
              )}
              {liveRows.length > 0 && (
                <>
                  <div className="expr-tester-context-group-label">── Editor / runtime ──</div>
                  {liveRows.map(([k, v]) => (
                    <div key={k} className="expr-tester-context-row">
                      <span className="expr-tester-context-key">{k}</span>
                      <span className="expr-tester-context-value">{String(v ?? "")}</span>
                    </div>
                  ))}
                </>
              )}
              {fileRows.length === 0 && liveRows.length === 0 && (
                <div className="expr-tester-context-empty">No context values available.</div>
              )}
            </div>
          </div>
        </>
      )}

      <div>
        <div className="expr-tester-section-label" style={{ marginBottom: 4 }}>Expression</div>
        <WhenExpressionEditor value={expression} onChange={setExpression} height={32} />
      </div>

      {evalResult.kind !== "empty" && (
        <div className={`expr-tester-result ${evalResult.kind === "match" ? "match" : evalResult.kind === "no-match" ? "no-match" : "error"}`}>
          {evalResult.kind === "match" && "✓ match"}
          {evalResult.kind === "no-match" && "✗ no match"}
          {evalResult.kind === "error" && `⚠ ${evalResult.message}`}
        </div>
      )}
    </div>
  );
}
