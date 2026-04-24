import React, { useEffect, useRef, useCallback } from "react";
import type * as monacoType from "monaco-editor";
import type { FileEntity } from "../../../contracts/files/FileEntity";
import type { TextEditorRegistry } from "./TextEditorRegistry";
import { MonacoTextEditorApi } from "./MonacoTextEditorApi";

void React;

let monacoModuleInstance: typeof monacoType | null = null;

async function getMonaco(): Promise<typeof monacoType> {
  if (!monacoModuleInstance) {
    monacoModuleInstance = await import("monaco-editor");
  }
  return monacoModuleInstance;
}

export type TextEditorComponentProps = {
  file?: FileEntity;
  registry: TextEditorRegistry;
};

export function TextEditorComponent({ file, registry }: TextEditorComponentProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const apiRef = useRef<MonacoTextEditorApi | null>(null);
  const disposablesRef = useRef<monacoType.IDisposable[]>([]);
  const pendingFileRef = useRef<FileEntity | null>(null);
  const initStartedRef = useRef(false);
  const initGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const initEditorOnce = useCallback(async (fileToLoad: FileEntity | undefined) => {
    if (initStartedRef.current || editorRef.current) {
      return;
    }
    initStartedRef.current = true;
    const generation = ++initGenerationRef.current;

    if (!containerRef.current) {
      initStartedRef.current = false;
      return;
    }

    const monaco = await getMonaco();

    if (!mountedRef.current || generation !== initGenerationRef.current || !containerRef.current || editorRef.current) {
      initStartedRef.current = false;
      return;
    }

    const editor = monaco.editor.create(containerRef.current, {
      value: "",
      theme: "vs-dark",
      automaticLayout: true,
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      fontSize: 14,
      lineNumbers: "on",
      renderLineHighlight: "all",
      glyphMargin: false,
      folding: true,
      wordWrap: "off",
      model: null
    });

    editorRef.current = editor;

    const api = new MonacoTextEditorApi();
    api.attach(editor);
    apiRef.current = api;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0 && entry.contentRect.height > 0) {
          requestAnimationFrame(() => {
            editor.layout({ width: entry.contentRect.width, height: entry.contentRect.height });
          });
        }
      }
    });
    resizeObserver.observe(containerRef.current, { box: "content-box" });
    disposablesRef.current.push({ dispose: () => resizeObserver.disconnect() });

    const { width, height } = containerRef.current.getBoundingClientRect();
    if (width > 0 && height > 0) {
      editor.layout({ width, height });
    }

    disposablesRef.current.push(
      editor.onDidDispose(() => {
        api.dispose();
        registry.onEditorDisposed();
        editorRef.current = null;
        apiRef.current = null;
      })
    );

    disposablesRef.current.push(
      editor.onDidFocusEditorWidget(() => {
        if (!containerRef.current) return;
        const { width, height } = containerRef.current.getBoundingClientRect();
        if (width > 0 && height > 0) {
          editor.layout({ width, height });
        }
      })
    );

    registry.onEditorReady(api);

    api.onDidChangeModelContent(() => {
      const currentFile = registry.getActiveFile();
      if (currentFile?.fileId) {
        registry.markDirty(currentFile.fileId);
      }
    });

    const fileForInitialLoad = pendingFileRef.current ?? fileToLoad;
    if (fileForInitialLoad) {
      pendingFileRef.current = fileForInitialLoad;
      await registry.openFileAsync(fileForInitialLoad);
      pendingFileRef.current = null;
    }

    initStartedRef.current = false;
  }, [registry]);

  useEffect(() => {
    if (!file) return;
    if (editorRef.current) {
      if (file === pendingFileRef.current) return;
      pendingFileRef.current = file;
      registry.openFileAsync(file);
      return;
    }
    pendingFileRef.current = file;
    void initEditorOnce(file);
  }, [file?.fileId, registry, initEditorOnce]);

  useEffect(() => {
    mountedRef.current = true;
    initStartedRef.current = false;
    return () => {
      mountedRef.current = false;
      initStartedRef.current = false;
      initGenerationRef.current += 1;
      if (editorRef.current) {
        const disposedViewState = apiRef.current?.getViewState();
        registry.captureActiveViewState(disposedViewState);
        editorRef.current.dispose();
        editorRef.current = null;
      }
      for (const d of disposablesRef.current) {
        d.dispose();
      }
      disposablesRef.current = [];
    };
  }, []);

  return (
    <div className="text-editor-component">
      <div ref={containerRef} className="text-editor-container" />
    </div>
  );
}
