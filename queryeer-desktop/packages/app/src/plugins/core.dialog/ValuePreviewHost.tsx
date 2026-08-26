import * as React from "react";
import type * as monacoType from "monaco-editor";
import {
  closeValuePreviewDialog,
  focusValuePreviewDialog,
  listValuePreviewDialogs,
  minimizeValuePreviewDialog,
  moveValuePreviewDialog,
  resizeValuePreviewDialog,
  restoreValuePreviewDialog,
  subscribeValuePreviewDialog,
  type ValuePreviewWindowState,
} from "./value-preview-dialog-service";
import "./value-preview-dialog.css";
import { isPrimaryModifier } from "../../shared/platform-utils";

let monacoModuleInstance: typeof monacoType | null = null;
const VALUE_PREVIEW_Z_INDEX_BASE = 20_000;

export function toValuePreviewZIndex(relativeZIndex: number): number {
  return VALUE_PREVIEW_Z_INDEX_BASE + relativeZIndex;
}

async function getMonaco(): Promise<typeof monacoType> {
  if (!monacoModuleInstance) {
    monacoModuleInstance = await import("monaco-editor");
  }
  return monacoModuleInstance;
}

function languageFromMimeType(mimeType: string | undefined): string {
  if (mimeType === "application/json") return "json";
  if (mimeType === "application/xml" || mimeType === "text/xml") return "xml";
  return "plaintext";
}

export function buildValuePreviewEditorOptions(
  value: string,
  mimeType: string | undefined
): monacoType.editor.IStandaloneEditorConstructionOptions {
  return {
    value,
    language: languageFromMimeType(mimeType),
    readOnly: true,
    lineNumbers: "on",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    automaticLayout: false,
    fixedOverflowWidgets: true,
    fontSize: 12,
    lineHeight: 18,
    colorDecorators: false,
    folding: true,
    foldingStrategy: "auto",
    foldingHighlight: true,
    showFoldingControls: "always",
    unfoldOnClickAfterEndOfLine: true,
    find: {
      addExtraSpaceOnTop: false,
      autoFindInSelection: "never",
      seedSearchStringFromSelection: "never"
    }
  };
}

function buildWindowLabel(title: string, value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return title;
  }
  const snippet = normalized.length > 36 ? `${normalized.slice(0, 36)}...` : normalized;
  return `${title} - ${snippet}`;
}

function ValuePreviewWindow({ windowState }: { windowState: ValuePreviewWindowState }): JSX.Element {
  const windowRef = React.useRef<HTMLDivElement | null>(null);
  const editorContainerRef = React.useRef<HTMLDivElement | null>(null);
  const editorRef = React.useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const resizeObserverRef = React.useRef<ResizeObserver | null>(null);

  React.useEffect(() => {
    if (!editorContainerRef.current) {
      return;
    }
    let mounted = true;
    let createdEditor: monacoType.editor.IStandaloneCodeEditor | null = null;

    void getMonaco().then((monaco) => {
      if (!mounted || !editorContainerRef.current) {
        return;
      }

      const editor = monaco.editor.create(
        editorContainerRef.current,
        buildValuePreviewEditorOptions(windowState.value, windowState.mimeType)
      );
      createdEditor = editor;
      editorRef.current = editor;

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
            requestAnimationFrame(() => {
              editor.layout({ width: entry.contentRect.width, height: entry.contentRect.height });
            });
          }
        }
      });
      resizeObserver.observe(editorContainerRef.current, { box: "content-box" });
      resizeObserverRef.current = resizeObserver;
    }).catch(() => {});

    return () => {
      mounted = false;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      createdEditor?.dispose();
      editorRef.current = null;
    };
  }, [windowState.id]);

  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const model = editor.getModel();
    if (!model) {
      return;
    }
    const monaco = monacoModuleInstance;
    if (monaco) {
      monaco.editor.setModelLanguage(model, languageFromMimeType(windowState.mimeType));
    }
    if (model.getValue() !== windowState.value) {
      model.setValue(windowState.value);
    }
  }, [windowState.value, windowState.mimeType]);

  const onHeaderMouseDown = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    focusValuePreviewDialog(windowState.id);

    const startX = event.clientX;
    const startY = event.clientY;
    const baseX = windowState.x;
    const baseY = windowState.y;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      moveValuePreviewDialog(windowState.id, Math.round(baseX + deltaX), Math.round(baseY + deltaY));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("dialog-value-preview-dragging");
    };

    document.body.classList.add("dialog-value-preview-dragging");
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [windowState.id, windowState.x, windowState.y]);

  const handleCopyAll = React.useCallback(() => {
    void navigator.clipboard.writeText(windowState.value);
  }, [windowState.value]);

  const handleCopySelection = React.useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      void navigator.clipboard.writeText(windowState.value);
      return;
    }
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      void navigator.clipboard.writeText(windowState.value);
      return;
    }
    const selectedText = editor.getModel()?.getValueInRange(selection);
    void navigator.clipboard.writeText(selectedText ?? windowState.value);
  }, [windowState.value]);

  const handleSelectAll = React.useCallback(() => {
    editorRef.current?.focus();
    const model = editorRef.current?.getModel();
    if (model) {
      editorRef.current?.setSelection(model.getFullModelRange());
    }
  }, []);

  const handleFind = React.useCallback(() => {
    editorRef.current?.focus();
    editorRef.current?.trigger("value-preview", "actions.find", null);
  }, []);

  const onResizePointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    focusValuePreviewDialog(windowState.id);

    const startX = event.clientX;
    const startY = event.clientY;
    const baseWidth = windowState.width;
    const baseHeight = windowState.height;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = baseWidth + (moveEvent.clientX - startX);
      const nextHeight = baseHeight + (moveEvent.clientY - startY);
      resizeValuePreviewDialog(windowState.id, nextWidth, nextHeight);
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      document.body.classList.remove("dialog-value-preview-resizing");
    };

    document.body.classList.add("dialog-value-preview-resizing");
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }, [windowState.id, windowState.width, windowState.height]);

  const windowLabel = React.useMemo(
    () => buildWindowLabel(windowState.title, windowState.value),
    [windowState.title, windowState.value]
  );

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => {
      windowRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [windowState.id]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!windowRef.current?.contains(event.target as Node)) {
        return;
      }
      const isMod = isPrimaryModifier(event);
      if (isMod && event.key === "f") {
        event.preventDefault();
        handleFind();
        return;
      }
      if (isMod && event.key === "a") {
        event.preventDefault();
        handleSelectAll();
        return;
      }
      if (isMod && event.key === "c") {
        event.preventDefault();
        handleCopySelection();
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [handleFind, handleSelectAll, handleCopySelection]);

  return (
    <div
      ref={windowRef}
      className="dialog-value-preview-window"
      role="dialog"
      aria-modal="false"
      aria-label={windowLabel}
      tabIndex={0}
      style={{
        left: `${windowState.x}px`,
        top: `${windowState.y}px`,
        width: `${windowState.width}px`,
        height: `${windowState.height}px`,
        zIndex: toValuePreviewZIndex(windowState.zIndex),
      }}
      onMouseDown={() => {
        focusValuePreviewDialog(windowState.id);
        windowRef.current?.focus();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeValuePreviewDialog(windowState.id);
        }
      }}
    >
      <div className="dialog-value-preview-header" onMouseDown={onHeaderMouseDown}>
        <span className="dialog-value-preview-title" title={windowLabel}>{windowLabel}</span>
        <div className="dialog-value-preview-actions">
          <button type="button" className="dialog-value-preview-action-btn" onClick={handleFind} aria-label="Find" title="Find (Ctrl+F)">Find</button>
          <button type="button" className="dialog-value-preview-action-btn" onClick={handleSelectAll} aria-label="Select all" title="Select all (Ctrl+A)">Select all</button>
          <button type="button" className="dialog-value-preview-action-btn" onClick={handleCopyAll} aria-label="Copy all" title="Copy all to clipboard">Copy</button>
          <button type="button" className="dialog-value-preview-min" onClick={() => minimizeValuePreviewDialog(windowState.id)} aria-label="Minimize">_</button>
          <button type="button" className="dialog-value-preview-close" onClick={() => closeValuePreviewDialog(windowState.id)}>Close</button>
        </div>
      </div>
      <div className="dialog-value-preview-meta">{windowState.mimeType ?? "text/plain"}</div>
      <div className="dialog-value-preview-editor" ref={editorContainerRef} />
      <div className="dialog-value-preview-resizer" onPointerDown={onResizePointerDown} />
    </div>
  );
}

export function ValuePreviewHost(): JSX.Element | null {
  const [, setVersion] = React.useState(0);

  React.useEffect(() => {
    return subscribeValuePreviewDialog(() => {
      setVersion((previous) => previous + 1);
    });
  }, []);

  const windows = listValuePreviewDialogs();
  if (windows.length === 0) {
    return null;
  }

  const floatingWindows = windows.filter((windowState) => !windowState.minimized);
  const minimizedWindows = windows.filter((windowState) => windowState.minimized);

  return (
    <>
      {floatingWindows.map((windowState) => (
        <ValuePreviewWindow key={windowState.id} windowState={windowState} />
      ))}
      {minimizedWindows.length > 0 && (
        <div className="dialog-value-preview-minimized-strip" role="toolbar" aria-label="Minimized value previews">
          {minimizedWindows.map((windowState) => {
            const windowLabel = buildWindowLabel(windowState.title, windowState.value);
            return (
            <button
              key={windowState.id}
              type="button"
              className="dialog-value-preview-minimized-item"
              onClick={() => restoreValuePreviewDialog(windowState.id)}
              title={windowLabel}
            >
              {windowLabel}
            </button>
            );
          })}
        </div>
      )}
    </>
  );
}
