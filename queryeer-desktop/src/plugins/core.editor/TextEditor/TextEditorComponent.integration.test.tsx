import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../../contracts/files/FilesRegistry";
import { preloadMonaco } from "./MonacoTextEditorApi";
import { TextEditorComponent } from "./TextEditorComponent";
import { TextEditorRegistry } from "./TextEditorRegistry";

void React;

type FakeEditor = {
  id: number;
  layout: ReturnType<typeof vi.fn>;
  restoreViewState: ReturnType<typeof vi.fn>;
  saveViewState: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  getModel: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  onDidDispose: (listener: () => void) => { dispose: () => void };
  onDidFocusEditorWidget: (listener: () => void) => { dispose: () => void };
  onDidChangeModelContent: (listener: () => void) => { dispose: () => void };
  dispose: () => void;
};

const editors: FakeEditor[] = [];
const modelByUri = new Map<string, { uri: { toString: () => string }; getLanguageId: () => string; getValue: () => string; getValueInRange: () => string; getLineCount: () => number; getLineContent: () => string; getOffsetAt: () => number; getPositionAt: () => { lineNumber: number; column: number }; getWordAtPosition: () => null }>();

vi.mock("monaco-editor", () => {
  let nextEditorId = 0;

  const createFakeEditor = (): FakeEditor => {
    const disposeListeners: Array<() => void> = [];
    const focusListeners: Array<() => void> = [];

    const editor: FakeEditor = {
      id: ++nextEditorId,
      layout: vi.fn(),
      restoreViewState: vi.fn(),
      saveViewState: vi.fn(),
      setModel: vi.fn(),
      getModel: vi.fn(() => null),
      focus: vi.fn(),
      onDidDispose: (listener) => {
        disposeListeners.push(listener);
        return { dispose: () => {} };
      },
      onDidFocusEditorWidget: (listener) => {
        focusListeners.push(listener);
        return { dispose: () => {} };
      },
      onDidChangeModelContent: (_listener) => ({ dispose: () => {} }),
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TextEditorComponent integration: non-file -> file switch", () => {
  let rootElement: HTMLDivElement;
  let root: Root;
  let registry: TextEditorRegistry;
  let filesById: Map<string, FileEntity>;

  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    editors.length = 0;
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
    const mockFilesRegistry: FilesRegistry = {
      capabilities: {
        registerCapabilities: vi.fn(),
        hasCapability: vi.fn(() => false),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn()
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
});
