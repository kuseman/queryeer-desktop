import React, { useEffect, useRef, useCallback } from "react";
import type * as monacoType from "monaco-editor";
import type { FileEntity } from "../../../contracts/files/FileEntity";
import type { TextEditorRegistry } from "./TextEditorRegistry";
import type { EditorRegistryHost } from "../../../contracts/editor/EditorCapability";
import type { OutlineRegistry } from "../../../contracts/extensions/OutlineExtension";
import { MonacoTextEditorApi } from "./MonacoTextEditorApi";
import { getCoreSettingsService } from "../../core.settings/service";
import { createTextEditorHandle } from "./TextEditorCapabilities";
import {
  buildMonacoCreateOptions,
  buildMonacoModelUpdateOptions,
  buildMonacoUpdateOptions
} from "./editor-settings";
import "./text-editor.css";

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
  editorRegistryHost?: EditorRegistryHost;
  outlineRegistry?: OutlineRegistry;
  editorId?: string;
};

export function TextEditorComponent({ file, registry, editorRegistryHost, outlineRegistry, editorId }: TextEditorComponentProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const apiRef = useRef<MonacoTextEditorApi | null>(null);
  const disposablesRef = useRef<monacoType.IDisposable[]>([]);
  const pendingFileRef = useRef<FileEntity | null>(null);
  const initStartedRef = useRef(false);
  const initGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const applyEditorSettings = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const settingsService = getCoreSettingsService();
    editor.updateOptions(buildMonacoUpdateOptions(settingsService));
    const model = editor.getModel();
    model?.updateOptions(buildMonacoModelUpdateOptions(settingsService));
  }, []);

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

    const settingsService = getCoreSettingsService();
    const editor = monaco.editor.create(
      containerRef.current,
      buildMonacoCreateOptions(settingsService)
    );

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

    applyEditorSettings();

    try {
      const kC = (monaco as unknown as Record<string, unknown>)["KeyCode"] as
        | { F1: number; KeyP: number; KeyO: number }
        | undefined;
      const kM = (monaco as unknown as Record<string, unknown>)["KeyMod"] as
        | { CtrlCmd: number; Shift: number }
        | undefined;

      if (kC && kM && typeof editor.addCommand === "function") {
        const openQuickCommand = (prefill?: string): void => {
          import("../../../plugins/core.quickcommand/service")
            .then(({ getQuickCommandService }) => {
              getQuickCommandService()?.open(prefill ?? "");
            })
            .catch(() => {});
        };
        editor.addCommand(kC.F1, () => openQuickCommand("#"));
        editor.addCommand(kM.CtrlCmd | kC.KeyP, () => openQuickCommand());
        editor.addCommand(kM.CtrlCmd | kM.Shift | kC.KeyO, () => openQuickCommand("@"));
      }
    } catch {
      // Not available in test environment
    }

    disposablesRef.current.push(
      editor.onDidDispose(() => {
        if (editorRegistryHost && outlineRegistry) {
          editorRegistryHost.setActiveEditor(null);
        }
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
        if (editorRegistryHost && outlineRegistry) {
          const handle = createTextEditorHandle(editorId ?? "core.editor.text", api, outlineRegistry, registry);
          editorRegistryHost.setActiveEditor(handle);
        }
      })
    );

    registry.onEditorReady(api);

    if (editorRegistryHost && outlineRegistry) {
      const handle = createTextEditorHandle(editorId ?? "core.editor.text", api, outlineRegistry, registry);
      editorRegistryHost.setActiveEditor(handle);
    }

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
      api.focus();
      pendingFileRef.current = null;
    }

    initStartedRef.current = false;
  }, [applyEditorSettings, registry, editorRegistryHost, outlineRegistry, editorId]);

  useEffect(() => {
    if (!file) return;
    if (editorRef.current) {
      if (file === pendingFileRef.current) return;
      pendingFileRef.current = file;
    void registry.openFileAsync(file).then(() => {
      apiRef.current?.focus();
      if (editorRegistryHost && outlineRegistry && apiRef.current) {
        const handle = createTextEditorHandle(editorId ?? "core.editor.text", apiRef.current, outlineRegistry, registry);
        editorRegistryHost.setActiveEditor(handle);
      }
    });
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

  useEffect(() => {
    const settingsService = getCoreSettingsService();
    if (!settingsService) {
      return;
    }

    applyEditorSettings();
    return settingsService.subscribe(() => {
      applyEditorSettings();
    });
  }, [applyEditorSettings]);

  return (
    <div className="text-editor-component">
      <div ref={containerRef} className="text-editor-container" />
    </div>
  );
}