import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { ContextMenuProvider } from "@queryeer/api/extensions/ContextMenuExtension";
import type { OutlineRegistry } from "@queryeer/api/extensions/OutlineExtension";
import type { EditorRegistryHost } from "@queryeer/api/editor/EditorCapability";
import { preloadMonaco } from "./MonacoTextEditorApi";
import { TextEditorComponent } from "./TextEditorComponent";
import { TextEditorRegistry } from "./TextEditorRegistry";

void React;

type FakeEditor = {
  id: number;
  layout: ReturnType<typeof vi.fn>;
  updateOptions: ReturnType<typeof vi.fn>;
  restoreViewState: ReturnType<typeof vi.fn>;
  saveViewState: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  onDidDispose: (listener: () => void) => { dispose: () => void };
  onDidFocusEditorWidget: (listener: () => void) => { dispose: () => void };
  onDidChangeModelContent: (listener: (event: unknown) => void) => { dispose: () => void };
  onDidChangeCursorSelection: (listener: (event: unknown) => void) => { dispose: () => void };
  triggerModelContentChange: (event?: { isFlush?: boolean }) => void;
  getValue: ReturnType<typeof vi.fn>;
  getSelections: ReturnType<typeof vi.fn>;
  setSelections: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  getTargetAtClientPoint: ReturnType<typeof vi.fn>;
  dispose: () => void;
};

const editors: FakeEditor[] = [];
const settingsValues = new Map<string, unknown>();
const settingsSubscribers = new Set<() => void>();
const modelByUri = new Map<string, { uri: { toString: () => string }; getLanguageId: () => string; getValue: () => string; getValueInRange: () => string; getLineCount: () => number; getLineContent: () => string; getOffsetAt: () => number; getPositionAt: () => { lineNumber: number; column: number }; getWordAtPosition: () => null }>();

vi.mock("../../core.settings/service", () => ({
  getCoreSettingsService: () => ({
    getValue: (settingId: string) => settingsValues.get(settingId),
    subscribe: (listener: () => void) => {
      settingsSubscribers.add(listener);
      return () => {
        settingsSubscribers.delete(listener);
      };
    }
  })
}));

const getContextMenuProvidersMock = vi.hoisted(() => vi.fn<() => ContextMenuProvider[]>(() => []));

vi.mock("../../../core/plugin-runtime/ExtensionRegistry", () => ({
  getContextMenuProviders: getContextMenuProvidersMock,
}));

vi.mock("monaco-editor", () => {
  let nextEditorId = 0;

  const createFakeEditor = (): FakeEditor => {
    const disposeListeners: Array<() => void> = [];
    const focusListeners: Array<() => void> = [];
    const contentChangeListeners: Array<(event: unknown) => void> = [];

    const editor: FakeEditor = {
      id: ++nextEditorId,
      layout: vi.fn(),
      updateOptions: vi.fn(),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(),
      setModel: vi.fn(),
      getModel: vi.fn(() => null),
      getValue: vi.fn(() => "edited from monaco"),
      getSelections: vi.fn(() => null),
      setSelections: vi.fn(),
      getSelection: vi.fn(() => null),
      getTargetAtClientPoint: vi.fn(() => ({ position: { lineNumber: 2, column: 1 } })),
      focus: vi.fn(),
      onDidDispose: (listener) => {
        disposeListeners.push(listener);
        return { dispose: () => {} };
      },
      onDidFocusEditorWidget: (listener) => {
        focusListeners.push(listener);
        return { dispose: () => {} };
      },
      onDidChangeCursorSelection: () => {
        return { dispose: () => {} };
      },
      onDidChangeModelContent: (listener) => {
        contentChangeListeners.push(listener);
        return { dispose: () => {} };
      },
      triggerModelContentChange: (event) => {
        for (const listener of contentChangeListeners) {
          listener({
            changes: [
              {
                range: {
                  startLineNumber: 1,
                  startColumn: 1,
                  endLineNumber: 1,
                  endColumn: 1
                },
                rangeLength: 0,
                text: "edited"
              }
            ],
            eol: 1,
            isFlush: event?.isFlush ?? false,
            versionId: 2
          });
        }
      },
      dispose: () => {
        for (const listener of disposeListeners) {
          listener();
        }
      }
    };

    editors.push(editor);
    return editor;
  };

  return {
    editor: {
      create: vi.fn(() => createFakeEditor()),
      getModel: vi.fn((uri: { toString: () => string }) => modelByUri.get(uri.toString()) ?? null),
      createModel: vi.fn((text: string, languageId: string, uri: { toString: () => string }) => {
        const model = {
          uri,
          getLanguageId: () => languageId,
          getValue: () => text,
          getValueInRange: () => text,
          getLineCount: () => 1,
          getLineContent: () => text,
          getOffsetAt: () => 0,
          getPositionAt: () => ({ lineNumber: 1, column: 1 }),
          getWordAtPosition: () => null
        };
        modelByUri.set(uri.toString(), model);
        return model;
      }),
      ScrollType: { Smooth: 0 }
    },
    Uri: {
      parse: (value: string) => ({ toString: () => value })
    },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number
      ) {}
    }
  };
});

function makeFile(overrides: Partial<FileEntity>): FileEntity {
  return {
    fileId: "file-1",
    uri: "file:///test.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    version: 1,
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

function createOutlineRegistry(): OutlineRegistry {
  return {
    registerOutlineProvider: vi.fn(),
    registerSupplementaryOutlineProvider: vi.fn(),
    hasProvider: vi.fn(() => false),
    getProvider: vi.fn(),
    getSymbols: vi.fn(async () => [])
  } as unknown as OutlineRegistry;
}

function createEditorRegistryHost() {
  return {
    getActiveEditor: vi.fn(() => null),
    setActiveEditor: vi.fn(),
    onActiveEditorChanged: vi.fn(() => ({ dispose: vi.fn() })),
    registerContentRepository: vi.fn(() => () => {}),
    resolveFileContent: vi.fn(),
    broadcastContentUpdate: vi.fn(),
    applyRecoveredContent: vi.fn(),
    onContentDirty: vi.fn(() => () => {})
  } as unknown as EditorRegistryHost & { setActiveEditor: ReturnType<typeof vi.fn> };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TextEditorComponent integration: non-file -> file switch", () => {
  let rootElement: HTMLDivElement;
  let root: Root;
  let registry: TextEditorRegistry;
  let filesById: Map<string, FileEntity>;
  let markDirtySpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    editors.length = 0;
    settingsValues.clear();
    settingsSubscribers.clear();
    modelByUri.clear();
    await preloadMonaco();

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);

    registry = new TextEditorRegistry();
    filesById = new Map<string, FileEntity>();
    markDirtySpy = vi.fn();
    const mockFilesRegistry: FilesRegistry = {
      capabilities: {
        registerCapabilities: vi.fn(),
        registerLabel: vi.fn(),
        registerPreferredNewFileMimeType: vi.fn(),
        listPreferredNewFileMimeTypes: vi.fn(() => []),
        getLabel: vi.fn(),
        hasCapability: vi.fn(() => false),
        listMimeTypesByCapability: vi.fn(() => []),
        listAllMimeTypes: vi.fn(() => []),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn()
      },
      mimeIcons: {
        registerMimeIcon: vi.fn(),
        getMimeIcon: vi.fn(),
        listMimeIcons: vi.fn(() => [])
      },
      openFile: vi.fn(),
      closeFile: vi.fn(),
      getFile: (fileId: string) => filesById.get(fileId) ?? undefined,
      listFiles: vi.fn(() => []),
      updateFile: vi.fn(),
      subscribe: vi.fn(),
      registerMimeResolver: vi.fn(),
      registerEditorResolver: vi.fn(),
      classifyUri: vi.fn(() => "text/plain"),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      markDirty: markDirtySpy
    };
    registry.setFilesRegistry(mockFilesRegistry);

    (window as unknown as { appShell: unknown }).appShell = {
      readFile: vi.fn(async () => ({ success: true, content: "select 1" }))
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    rootElement.remove();
    vi.unstubAllGlobals();
  });

  it("restores runtime view state for dirty file after unmount/remount", async () => {
    const file = makeFile({ fileId: "file-dirty", uri: "file:///dirty.sql", dirtyVsDisk: true });
    filesById.set(file.fileId, file);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const firstEditor = editors[0];
    expect(firstEditor).toBeTruthy();
    const runtimeState = { viewState: { scrollTop: 420 }, cursorState: [{ line: 23, column: 2 }] };
    firstEditor.saveViewState.mockReturnValue(runtimeState);

    await act(async () => {
      root.render(<div data-testid="observability">Observability</div>);
      await flush();
    });

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const secondEditor = editors[1];
    expect(secondEditor).toBeTruthy();
    expect(secondEditor.restoreViewState).toHaveBeenCalledWith(runtimeState);
  });

  it("updates monaco options when editor settings change", async () => {
    const file = makeFile({ fileId: "file-settings", uri: "file:///settings.sql", dirtyVsDisk: false });
    filesById.set(file.fileId, file);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();
    expect(editor.updateOptions).toHaveBeenCalled();

    settingsValues.set("core.editor.texteditor.fontSize", 18);
    settingsValues.set("core.editor.texteditor.wordWrap", "on");
    for (const listener of settingsSubscribers) {
      listener();
    }

    expect(editor.updateOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fontSize: 18,
        wordWrap: "on"
      })
    );
  });

  it("syncs TextEditorRegistry model content on monaco change events", async () => {
    const file = makeFile({ fileId: "file-content-sync", uri: "file:///content-sync.sql" });
    filesById.set(file.fileId, file);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();

    await act(async () => {
      editor.triggerModelContentChange();
      await flush();
    });

    const model = registry.getModelForFile(file.fileId);
    expect(markDirtySpy).toHaveBeenCalledWith(file.fileId);
    expect(model?.getContent()).toBe("edited from monaco");
  });

  it("does not mark dirty on monaco flush events", async () => {
    const file = makeFile({ fileId: "file-flush", uri: "file:///flush.sql" });
    filesById.set(file.fileId, file);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();

    await act(async () => {
      editor.triggerModelContentChange({ isFlush: true });
      await flush();
    });

    expect(markDirtySpy).not.toHaveBeenCalled();
  });

  it("does not focus or register inactive editor groups while mounting", async () => {
    const file = makeFile({ fileId: "file-inactive", uri: "file:///inactive.sql" });
    filesById.set(file.fileId, file);
    const editorRegistryHost = createEditorRegistryHost();

    await act(async () => {
      root.render(
        <TextEditorComponent
          file={file}
          registry={registry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={createOutlineRegistry()}
          editorInstanceId="right:core.editor.text"
          isActiveEditorGroup={false}
        />
      );
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();
    expect(editor.focus).not.toHaveBeenCalled();
    expect(editorRegistryHost.setActiveEditor).not.toHaveBeenCalled();
  });

  it("focuses and registers the editor when its group becomes active", async () => {
    const file = makeFile({ fileId: "file-active-transition", uri: "file:///active-transition.sql" });
    filesById.set(file.fileId, file);
    const editorRegistryHost = createEditorRegistryHost();
    const outlineRegistry = createOutlineRegistry();

    await act(async () => {
      root.render(
        <TextEditorComponent
          file={file}
          registry={registry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={outlineRegistry}
          editorInstanceId="right:core.editor.text"
          isActiveEditorGroup={false}
        />
      );
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();
    expect(editorRegistryHost.setActiveEditor).not.toHaveBeenCalled();

    await act(async () => {
      root.render(
        <TextEditorComponent
          file={file}
          registry={registry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={outlineRegistry}
          editorInstanceId="right:core.editor.text"
          isActiveEditorGroup={true}
        />
      );
      await flush();
    });

    expect(editor.focus).toHaveBeenCalled();
    expect(editorRegistryHost.setActiveEditor).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: file.fileId })
    );
  });

  it("does not reactivate a stale file when editor loads complete out of order", async () => {
    const fileA = makeFile({ fileId: "file-a", uri: "file:///a.sql" });
    const fileB = makeFile({ fileId: "file-b", uri: "file:///b.sql" });
    const fileC = makeFile({ fileId: "file-c", uri: "file:///c.sql" });
    filesById.set(fileA.fileId, fileA);
    filesById.set(fileB.fileId, fileB);
    filesById.set(fileC.fileId, fileC);
    const editorRegistryHost = createEditorRegistryHost();
    const outlineRegistry = createOutlineRegistry();

    await act(async () => {
      root.render(
        <TextEditorComponent
          file={fileA}
          registry={registry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={outlineRegistry}
        />
      );
      await flush();
    });

    const pendingLoads = new Map<string, () => void>();
    const openFileSpy = vi.spyOn(registry, "openFileAsync").mockImplementation((nextFile) =>
      new Promise<void>((resolve) => pendingLoads.set(nextFile.fileId, resolve))
    );

    await act(async () => {
      root.render(
        <TextEditorComponent
          file={fileB}
          registry={registry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={outlineRegistry}
        />
      );
    });
    await act(async () => {
      root.render(
        <TextEditorComponent
          file={fileC}
          registry={registry}
          editorRegistryHost={editorRegistryHost}
          outlineRegistry={outlineRegistry}
        />
      );
    });

    await act(async () => {
      pendingLoads.get(fileC.fileId)?.();
      await flush();
    });
    editorRegistryHost.setActiveEditor.mockClear();
    await act(async () => {
      pendingLoads.get(fileB.fileId)?.();
      await flush();
    });

    expect(editorRegistryHost.setActiveEditor).not.toHaveBeenCalled();
    openFileSpy.mockRestore();
  });
});

describe("TextEditorComponent context menu: multi-cursor selection", () => {
  let rootElement: HTMLDivElement;
  let root: Root;
  let registry: TextEditorRegistry;
  let filesById: Map<string, FileEntity>;

  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    editors.length = 0;
    settingsValues.clear();
    settingsSubscribers.clear();
    modelByUri.clear();
    getContextMenuProvidersMock.mockReturnValue([]);
    await preloadMonaco();

    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);

    registry = new TextEditorRegistry();
    filesById = new Map<string, FileEntity>();
    const mockFilesRegistry: FilesRegistry = {
      capabilities: {
        registerCapabilities: vi.fn(),
        registerLabel: vi.fn(),
        registerPreferredNewFileMimeType: vi.fn(),
        listPreferredNewFileMimeTypes: vi.fn(() => []),
        getLabel: vi.fn(),
        hasCapability: vi.fn(() => false),
        listMimeTypesByCapability: vi.fn(() => []),
        listAllMimeTypes: vi.fn(() => []),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn()
      },
      mimeIcons: {
        registerMimeIcon: vi.fn(),
        getMimeIcon: vi.fn(),
        listMimeIcons: vi.fn(() => [])
      },
      openFile: vi.fn(),
      closeFile: vi.fn(),
      getFile: (fileId: string) => filesById.get(fileId) ?? undefined,
      listFiles: vi.fn(() => []),
      updateFile: vi.fn(),
      subscribe: vi.fn(),
      registerMimeResolver: vi.fn(),
      registerEditorResolver: vi.fn(),
      classifyUri: vi.fn(() => "text/plain"),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      markDirty: vi.fn()
    };
    registry.setFilesRegistry(mockFilesRegistry);

    (window as unknown as { appShell: unknown }).appShell = {
      readFile: vi.fn(async () => ({ success: true, content: "select 1" }))
    };
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    rootElement.remove();
    vi.unstubAllGlobals();
  });

  it("preserves multi-cursor selection on right-click", async () => {
    const file = makeFile({ fileId: "file-mc", uri: "file:///multi-cursor.sql", dirtyVsDisk: false });
    filesById.set(file.fileId, file);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();
    expect(editor.setSelections).not.toHaveBeenCalled();

    const selections = [
      { selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 10 },
      { selectionStartLineNumber: 5, selectionStartColumn: 1, positionLineNumber: 5, positionColumn: 20 }
    ];
    editor.getSelections.mockReturnValue(selections);

    const container = rootElement.querySelector<HTMLElement>(".text-editor-container");
    expect(container).toBeTruthy();

    await act(async () => {
      container!.dispatchEvent(new MouseEvent("mousedown", { button: 2, buttons: 2, cancelable: true, bubbles: true }));
      container!.dispatchEvent(new MouseEvent("contextmenu", { button: 2, clientX: 100, clientY: 200, cancelable: true, bubbles: true }));
      await flush();
    });

    expect(editor.setSelections).toHaveBeenCalledWith(selections);
  });

  it("does not restore selection when there is only a single cursor", async () => {
    const file = makeFile({ fileId: "file-sc", uri: "file:///single-cursor.sql", dirtyVsDisk: false });
    filesById.set(file.fileId, file);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();

    editor.getSelections.mockReturnValue([
      { selectionStartLineNumber: 1, selectionStartColumn: 1, positionLineNumber: 1, positionColumn: 10 }
    ]);

    const container = rootElement.querySelector<HTMLElement>(".text-editor-container");
    expect(container).toBeTruthy();

    await act(async () => {
      container!.dispatchEvent(new MouseEvent("mousedown", { button: 2, buttons: 2, cancelable: true, bubbles: true }));
      container!.dispatchEvent(new MouseEvent("contextmenu", { button: 2, clientX: 100, clientY: 200, cancelable: true, bubbles: true }));
      await flush();
    });

    expect(editor.setSelections).not.toHaveBeenCalled();
  });

  it("does not restore selection when there is no selection", async () => {
    const file = makeFile({ fileId: "file-ns", uri: "file:///no-selection.sql", dirtyVsDisk: false });
    filesById.set(file.fileId, file);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();

    editor.getSelections.mockReturnValue(null);

    const container = rootElement.querySelector<HTMLElement>(".text-editor-container");
    expect(container).toBeTruthy();

    await act(async () => {
      container!.dispatchEvent(new MouseEvent("mousedown", { button: 2, buttons: 2, cancelable: true, bubbles: true }));
      container!.dispatchEvent(new MouseEvent("contextmenu", { button: 2, clientX: 100, clientY: 200, cancelable: true, bubbles: true }));
      await flush();
    });

    expect(editor.setSelections).not.toHaveBeenCalled();
  });

  it("passes selection to context menu providers", async () => {
    const file = makeFile({ fileId: "file-provider", uri: "file:///provider.sql", dirtyVsDisk: false });
    filesById.set(file.fileId, file);

    const getItemsMock = vi.fn().mockResolvedValue([]);
    getContextMenuProvidersMock.mockReturnValue([{ id: "test", getItems: getItemsMock }]);

    await act(async () => {
      root.render(<TextEditorComponent file={file} registry={registry} />);
      await flush();
    });

    const editor = editors[0];
    expect(editor).toBeTruthy();

    editor.getSelections.mockReturnValue([
      { selectionStartLineNumber: 2, selectionStartColumn: 3, positionLineNumber: 5, positionColumn: 7 }
    ]);

    const container = rootElement.querySelector<HTMLElement>(".text-editor-container");
    expect(container).toBeTruthy();

    await act(async () => {
      container!.dispatchEvent(new MouseEvent("mousedown", { button: 2, buttons: 2, cancelable: true, bubbles: true }));
      container!.dispatchEvent(new MouseEvent("contextmenu", { button: 2, clientX: 100, clientY: 200, cancelable: true, bubbles: true }));
      await flush();
      await flush();
    });

    expect(getItemsMock).toHaveBeenCalledTimes(1);
    const ctx = getItemsMock.mock.calls[0][0];
    expect(ctx.selection).toEqual({
      startLineNumber: 2,
      startColumn: 3,
      endLineNumber: 5,
      endColumn: 7
    });
    expect(ctx.position).toEqual({ lineNumber: 2, column: 1 });
    expect(ctx.fileId).toBe(file.fileId);
  });
});
