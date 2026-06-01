import React, { useEffect, useRef, useCallback, useState } from "react";
import type * as monacoType from "monaco-editor";
import { isPrimaryModifier } from "../../../shared/platform-utils";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { TextEditorRegistry } from "./TextEditorRegistry";
import type { EditorRegistryHost } from "@queryeer/api/editor/EditorCapability";
import type { OutlineRegistry } from "@queryeer/api/extensions/OutlineExtension";
import type { TextRange } from "@queryeer/api/editor/EditorApi";
import type { ContextMenuContext, ContextMenuItem } from "@queryeer/api/extensions/ContextMenuExtension";
import { MonacoTextEditorApi } from "./MonacoTextEditorApi";
import { getCoreSettingsService } from "../../core.settings/service";
import { createTextEditorHandle } from "./TextEditorCapabilities";
import {
  buildMonacoCreateOptions,
  buildMonacoModelUpdateOptions,
  buildMonacoUpdateOptions
} from "./editor-settings";
import { getThemeService } from "../../core.themes/runtime";
import { getContextMenuProviders } from "../../../core/plugin-runtime/ExtensionRegistry";
import { EditorContextMenu } from "./EditorContextMenu";
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
  openContextMenuOnModifierClick?: boolean;
};

export function TextEditorComponent({ file, registry, editorRegistryHost, outlineRegistry, editorId, openContextMenuOnModifierClick = false }: TextEditorComponentProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monacoType.editor.IStandaloneCodeEditor | null>(null);
  const apiRef = useRef<MonacoTextEditorApi | null>(null);
  const disposablesRef = useRef<monacoType.IDisposable[]>([]);
  const pendingFileRef = useRef<FileEntity | null>(null);
  const initStartedRef = useRef(false);
  const initGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  // Keep a current-registry ref so the contextmenu DOM listener (which has [] deps) can always read it.
  const registryRef = useRef(registry);
  registryRef.current = registry;

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sections: ContextMenuItem[][]; loading?: boolean } | null>(null);
  const contextMenuRequestIdRef = useRef(0);

  // Capture multi-cursor selection before Monaco processes right-click (which collapses it)
  const rightClickSelectionsRef = useRef<monacoType.Selection[] | null>(null);

  const showEditorContextMenu = useCallback((x: number, y: number, position: { lineNumber: number; column: number } | null, savedSelections?: monacoType.Selection[] | null) => {
    const requestId = ++contextMenuRequestIdRef.current;
    const pasteFromClipboardFallback = async () => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      const text = await navigator.clipboard.readText();
      if (text.length === 0) {
        return;
      }
      const selection = editor.getSelection();
      if (!selection) {
        return;
      }
      editor.executeEdits("context-menu-paste", [{ range: selection, text, forceMoveMarkers: true }]);
    };

    const runEditorCommand = (commandId: string) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      editor.focus();
      if (commandId === "editor.action.clipboardPasteAction") {
        void pasteFromClipboardFallback();
        return;
      }
      try {
        const result = editor.trigger(null, commandId, null);
        void Promise.resolve(result).catch(() => {});
      } catch {
        return;
      }
    };
    const builtins: ContextMenuItem[] = [
      { id: "__cut__", label: "Cut", run: () => runEditorCommand("editor.action.clipboardCutAction") },
      { id: "__copy__", label: "Copy", run: () => runEditorCommand("editor.action.clipboardCopyAction") },
      { id: "__paste__", label: "Paste", run: () => runEditorCommand("editor.action.clipboardPasteAction") },
      { id: "__format__", label: "Format Document", run: () => runEditorCommand("editor.action.formatDocument") },
    ];

    setContextMenu({ x, y, sections: [], loading: true });

    if (!position) {
      if (requestId !== contextMenuRequestIdRef.current) {
        return;
      }
      setContextMenu({ x, y, sections: [builtins], loading: false });
      return;
    }

    const activeFile = registryRef.current.getActiveFile();
    if (!activeFile) {
      if (requestId !== contextMenuRequestIdRef.current) {
        return;
      }
      setContextMenu({ x, y, sections: [builtins], loading: false });
      return;
    }

    let selectionRange: TextRange | null = null;
    if (savedSelections && savedSelections.length > 0) {
      const sel = savedSelections[0];
      selectionRange = {
        startLineNumber: sel.selectionStartLineNumber,
        startColumn: sel.selectionStartColumn,
        endLineNumber: sel.positionLineNumber,
        endColumn: sel.positionColumn
      };
    }

    const ctx: ContextMenuContext = {
      position: { lineNumber: position.lineNumber, column: position.column },
      selection: selectionRange,
      mimeType: activeFile.mimeType ?? null,
      fileId: activeFile.fileId ?? null
    };

    void Promise.all(
      getContextMenuProviders().map((p) => p.getItems(ctx).catch((): ContextMenuItem[] => []))
    ).then((allItems) => {
      if (requestId !== contextMenuRequestIdRef.current) {
        return;
      }
      const providerSections = allItems.filter(s => s.length > 0);
      setContextMenu({ x, y, sections: [...providerSections, builtins], loading: false });
    });
  }, []);

  const applyEditorSettings = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const themeMode = getThemeService()?.getActiveThemeMode() ?? "dark";
    const monacoEditor = monacoModuleInstance?.editor as
      | { setTheme?: (theme: string) => void }
      | undefined;
    monacoEditor?.setTheme?.(themeMode === "dark" ? "vs-dark" : "vs");
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
        if (editorRegistryHost && outlineRegistry) {
          const handle = createTextEditorHandle(editorId ?? "core.editor.text", api, outlineRegistry, registry);
          editorRegistryHost.setActiveEditor(handle);
        }
      })
    );

    registry.onEditorReady(api);

    if (openContextMenuOnModifierClick) {
      let modifierPressed = false;
      const hoverDecorations = editor.createDecorationsCollection();

      const clearHoverDecoration = () => {
        hoverDecorations.clear();
      };

      const updateHoverDecoration = (position: { lineNumber: number; column: number } | null) => {
        if (!modifierPressed || !position) {
          clearHoverDecoration();
          return;
        }
        const model = editor.getModel();
        const word = model?.getWordAtPosition(position);
        if (!word) {
          clearHoverDecoration();
          return;
        }
        hoverDecorations.set([{
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          options: {
            inlineClassName: "text-editor-modifier-target"
          }
        }]);
      };

      disposablesRef.current.push(
        editor.onMouseDown((event) => {
          if (!event.event.leftButton) {
            return;
          }
          if (!isPrimaryModifier(event.event)) {
            return;
          }
          const position = event.target.position;
          if (!position) {
            return;
          }

          event.event.preventDefault();
          event.event.stopPropagation();
          showEditorContextMenu(event.event.posx, event.event.posy, position);
        })
      );

      disposablesRef.current.push(
        editor.onMouseMove((event) => {
          updateHoverDecoration(event.target.position ?? null);
        })
      );

      disposablesRef.current.push(
        editor.onKeyDown((event) => {
          if (!isPrimaryModifier(event)) {
            return;
          }
          modifierPressed = true;
        })
      );

      disposablesRef.current.push(
        editor.onKeyUp((event) => {
          if (event.keyCode === monaco.KeyCode.Ctrl || event.keyCode === monaco.KeyCode.Meta) {
            modifierPressed = false;
            clearHoverDecoration();
          }
        })
      );

      disposablesRef.current.push(
        editor.onDidBlurEditorText(() => {
          modifierPressed = false;
          clearHoverDecoration();
        })
      );

      disposablesRef.current.push({ dispose: () => hoverDecorations.clear() });
    }

    if (editorRegistryHost && outlineRegistry) {
      const handle = createTextEditorHandle(editorId ?? "core.editor.text", api, outlineRegistry, registry);
      editorRegistryHost.setActiveEditor(handle);
    }

    let dirtyTimer: ReturnType<typeof setTimeout> | null = null;
    api.onDidChangeModelContent((event) => {
      if (event.isFlush) {
        return;
      }
      if (dirtyTimer === null) {
        dirtyTimer = setTimeout(() => {
          dirtyTimer = null;
          const currentFile = registry.getActiveFile();
          if (currentFile?.fileId) {
            registry.markDirty(currentFile.fileId);
          }
        }, 0);
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
  }, [applyEditorSettings, registry, editorRegistryHost, outlineRegistry, editorId, showEditorContextMenu, openContextMenuOnModifierClick]);

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

  // Replace Monaco's native context menu with our own React menu.
  // Built-ins are shown immediately; provider items are fetched async and added when ready.
  //
  // Monaco processes right-click on mousedown (collapsing multi-cursor selections).
  // We capture the selection during the capturing phase (before Monaco) and restore it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Capture selection on right mousedown BEFORE Monaco processes it (capturing phase)
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 2) return;
      const editor = editorRef.current;
      if (!editor) return;
      rightClickSelectionsRef.current = editor.getSelections();
    };
    container.addEventListener("mousedown", handleMouseDown, true);

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Use getTargetAtClientPoint for the most precise position at contextmenu time,
      // then fetch provider items and add them to the already-visible menu.
      const editor = editorRef.current;
      const target = editor?.getTargetAtClientPoint(e.clientX, e.clientY);
      const position = target?.position;

      // Restore multi-cursor selection that was collapsed when Monaco processed the right-click
      const saved = rightClickSelectionsRef.current;
      if (saved && saved.length > 1 && editor) {
        editor.setSelections(saved);
      }

      showEditorContextMenu(e.clientX, e.clientY, position ?? null, saved);
    };

    container.addEventListener("contextmenu", handleContextMenu);
    return () => {
      container.removeEventListener("contextmenu", handleContextMenu);
      container.removeEventListener("mousedown", handleMouseDown, true);
    };
  }, [showEditorContextMenu]);

  return (
    <div className="text-editor-component">
      <div ref={containerRef} className="text-editor-container" />
      {contextMenu && (
        <EditorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sections={contextMenu.sections}
          loading={contextMenu.loading}
          onClose={() => {
            contextMenuRequestIdRef.current += 1;
            setContextMenu(null);
          }}
        />
      )}
    </div>
  );
}
