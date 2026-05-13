import React, { useState, useEffect, useRef } from "react";
import type * as monacoType from "monaco-editor";
import { WHEN_LANGUAGE_ID, STRING_METHODS, getAllContextVariables, setupWhenExpressionLanguage, getMonaco } from "./when-expression-language";
import { getRegisteredWhenExpressionTemplates } from "./when-expression-template-registry";
import "./when-expression-editor.css";

void React;

// ---------------------------------------------------------------------------
// InlineMonacoEditor
// ---------------------------------------------------------------------------

export type InlineMonacoEditorProps = {
  value: string;
  onChange: (value: string) => void;
  language: string;
  /** Fixed pixel height, or "flex" to fill the CSS-sized container. */
  height: number | "flex";
  readonly?: boolean;
  wordWrap?: boolean;
};

export function InlineMonacoEditor({ value, onChange, language, height, readonly, wordWrap = true }: InlineMonacoEditorProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  const isSettingValueRef = useRef(false);
  onChangeRef.current = onChange;
  const isFlex = height === "flex";

  useEffect(() => {
    let mounted = true;
    let createdEditor: monacoType.editor.IStandaloneCodeEditor | null = null;

    getMonaco().then((monaco) => {
      if (!mounted || !containerRef.current || editorRef.current) return;

      const editor = monaco.editor.create(containerRef.current, {
        value,
        language,
        readOnly: readonly,
        lineNumbers: "off",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        scrollbar: {
          vertical: wordWrap ? "hidden" : "auto",
          horizontal: wordWrap ? "hidden" : "auto",
          alwaysConsumeMouseWheel: false
        },
        wordWrap: wordWrap ? "on" : "off",
        automaticLayout: false,
        fixedOverflowWidgets: true,
        fontSize: 13,
        lineHeight: 20,
        padding: { top: 6, bottom: 6 },
        folding: false,
        renderLineHighlight: "none",
        contextmenu: false,
        glyphMargin: false,
        lineDecorationsWidth: 4,
        quickSuggestions: language === WHEN_LANGUAGE_ID ? { other: true, comments: false, strings: false } : false,
        suggestOnTriggerCharacters: language === WHEN_LANGUAGE_ID,
      });

      createdEditor = editor;
      editorRef.current = editor;

      const rect = containerRef.current?.getBoundingClientRect();
      editor.layout({
        width: rect ? rect.width : 400,
        height: isFlex ? (rect?.height ?? 200) : (height as number)
      });

      const contentSub = editor.onDidChangeModelContent(() => {
        if (!isSettingValueRef.current) {
          onChangeRef.current(editor.getValue());
        }
      });

      const resizeObs = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > 0) {
            requestAnimationFrame(() => {
              editor.layout({
                width: entry.contentRect.width,
                height: isFlex ? entry.contentRect.height : (height as number)
              });
            });
          }
        }
      });
      if (containerRef.current) {
        resizeObs.observe(containerRef.current);
      }

      (editor as unknown as { _resizeObs?: ResizeObserver })._resizeObs = resizeObs;
      (editor as unknown as { _contentSub?: monacoType.IDisposable })._contentSub = contentSub;
    }).catch(() => {/* ignore */});

    return () => {
      mounted = false;
      const editor = createdEditor;
      if (editor) {
        (editor as unknown as { _resizeObs?: ResizeObserver })._resizeObs?.disconnect();
        (editor as unknown as { _contentSub?: monacoType.IDisposable })._contentSub?.dispose();
        editor.dispose();
        editorRef.current = null;
      }
    };
  }, []); // create once — value sync handled by the effect below

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      isSettingValueRef.current = true;
      editor.setValue(value);
      isSettingValueRef.current = false;
    }
  }, [value]);

  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: readonly });
  }, [readonly]);

  return <div ref={containerRef} style={isFlex ? { flex: 1, minHeight: 0, minWidth: 0, width: "100%", maxWidth: "100%" } : { height: height as number, minWidth: 0, width: "100%", maxWidth: "100%" }} />;
}

// ---------------------------------------------------------------------------
// WhenInfoPopover — floating panel listing all context variables and methods
// ---------------------------------------------------------------------------

type WhenInfoPopoverProps = {
  readonly?: boolean;
  onSelectTemplate: (templateWhen: string) => void;
};

function WhenInfoPopover({ readonly, onSelectTemplate }: WhenInfoPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const templates = getRegisteredWhenExpressionTemplates();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <span className="when-expr-info-wrap">
      <button
        ref={btnRef}
        className="when-expr-info-btn"
        title="Show available context variables"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >ⓘ</button>
      {open && (
        <div ref={panelRef} className="when-expr-info-panel">
          {templates.length > 0 && (
            <div className="when-expr-info-section">
              <strong>Templates</strong>
              <table className="when-expr-info-table">
                <tbody>
                  {templates.map((template) => (
                    <tr key={`${template.name}-${template.when}`}>
                      <td className="when-expr-info-name">{template.name}</td>
                      <td className="when-expr-info-desc">
                        <code>{template.when}</code>
                        {template.description && <div>{template.description}</div>}
                      </td>
                      <td className="when-expr-info-action-cell">
                        <button
                          type="button"
                          className="when-expr-info-insert-btn"
                          disabled={readonly}
                          onClick={() => {
                            onSelectTemplate(template.when);
                            setOpen(false);
                          }}
                        >
                          Insert
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="when-expr-info-section">
            <strong>Context variables</strong>
            <table className="when-expr-info-table">
              <tbody>
                {getAllContextVariables().map((v) => (
                  <tr key={v.name}>
                    <td className="when-expr-info-name">{v.name}</td>
                    <td className="when-expr-info-type">{v.type}</td>
                    <td className="when-expr-info-desc">{v.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="when-expr-info-section">
            <strong>String methods</strong>
            <table className="when-expr-info-table">
              <tbody>
                {STRING_METHODS.map((m) => (
                  <tr key={m.name}>
                    <td className="when-expr-info-name">.{m.signature}</td>
                    <td className="when-expr-info-desc" colSpan={2}>{m.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="when-expr-info-example">
              Example: <code>activeFileMetadata.core.queryengine.jdbc.database.contains(&apos;prod&apos;)</code>
            </div>
          </div>
          <div className="when-expr-info-section">
            <strong>Operators</strong>
            <span className="when-expr-info-ops">
              <code>==</code> <code>!=</code> <code>&amp;&amp;</code> <code>||</code> <code>!</code>
            </span>
            <div className="when-expr-info-tip">
              Tip: press <kbd>Ctrl+Space</kbd> inside the editor for completions.
            </div>
          </div>
        </div>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// WhenExpressionEditor
// ---------------------------------------------------------------------------

export type WhenExpressionEditorProps = {
  value: string;
  onChange: (value: string) => void;
  height?: number;
  readonly?: boolean;
  wordWrap?: boolean;
};

export function WhenExpressionEditor({ value, onChange, height, readonly, wordWrap = false }: WhenExpressionEditorProps): JSX.Element {
  useEffect(() => {
    void setupWhenExpressionLanguage();
  }, []);

  return (
    <div className="when-expr-editor">
      <InlineMonacoEditor
        value={value}
        onChange={onChange}
        language={WHEN_LANGUAGE_ID}
        height={height ?? 32}
        wordWrap={wordWrap}
        readonly={readonly}
      />
      <WhenInfoPopover readonly={readonly} onSelectTemplate={onChange} />
    </div>
  );
}
