import { describe, it, expect, vi } from "vitest";
import { TextEditorOutlineCapability, createTextEditorHandle } from "./TextEditorOutlineCapability";
import type { OutlineSymbol } from "@queryeer/api/extensions/OutlineExtension";
import type { TextEditorApi } from "./TextEditorApi";
import type { OutlineRegistry } from "@queryeer/api/extensions/OutlineExtension";
import type { TextEditorRegistry } from "./TextEditorRegistry";

function createMockEditorApi() {
  const listeners: Array<() => void> = [];
  return {
    getContent: vi.fn(() => '{"key": "value"}'),
    revealLine: vi.fn(),
    setPosition: vi.fn(),
    onDidChangeModelContent: vi.fn((callback: () => void) => {
      listeners.push(callback);
      return { dispose: () => {
        const idx = listeners.indexOf(callback);
        if (idx !== -1) listeners.splice(idx, 1);
      }};
    }),
    _fireContentChange: () => {
      for (const cb of listeners) {
        cb();
      }
    }
  };
}

function createMockOutlineRegistry(hasProvider = true) {
  return {
    registerOutlineProvider: vi.fn(),
    registerSupplementaryOutlineProvider: vi.fn(),
    hasProvider: vi.fn(() => hasProvider),
    getProvider: vi.fn(),
    getSymbols: vi.fn(async (_mimeType: string, _content: string) => [
      {
        id: "test:1",
        name: "testSymbol",
        kind: "Key" as const,
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 },
        selectionRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 }
      }
    ])
  };
}

function createMockTextRegistry(getActiveFileResult: { fileId: string; mimeType: string } | null = { fileId: "file1", mimeType: "application/json" }) {
  return {
    getActiveFile: vi.fn(() => getActiveFileResult),
    getModelForFile: vi.fn(() => ({ getContent: () => '{"key": "value"}', getMimeType: () => "application/json" })),
    setActiveFileId: vi.fn(),
    onEditorReady: vi.fn(),
    onEditorDisposed: vi.fn(),
    markDirty: vi.fn(),
    openFile: vi.fn(),
    openFileAsync: vi.fn(),
    subscribe: vi.fn(),
    getActiveEditor: vi.fn()
  };
}

describe("TextEditorOutlineCapability", () => {
  it("getSymbols returns symbols when provider exists", async () => {
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(true);
    const textRegistry = createMockTextRegistry();

    const capability = new TextEditorOutlineCapability(
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    const symbols = await capability.getSymbols();
    expect(symbols.length).toBe(1);
    expect(symbols[0].name).toBe("testSymbol");
  });

  it("getSymbols returns empty when no provider for mimeType", async () => {
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(false);
    const textRegistry = createMockTextRegistry();

    const capability = new TextEditorOutlineCapability(
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    const symbols = await capability.getSymbols();
    expect(symbols).toEqual([]);
  });

  it("revealSymbol calls editor revealLine and setPosition", () => {
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(true);
    const textRegistry = createMockTextRegistry();

    const capability = new TextEditorOutlineCapability(
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    const symbol: OutlineSymbol = {
      id: "test:1",
      name: "test",
      kind: "Key",
      range: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 10 },
      selectionRange: { startLineNumber: 5, startColumn: 3, endLineNumber: 5, endColumn: 7 }
    };

    capability.revealSymbol(symbol);
    expect(editor.revealLine).toHaveBeenCalledWith(5, "top");
    expect(editor.setPosition).toHaveBeenCalledWith({ lineNumber: 5, column: 3 });
  });

  it("onSymbolsChanged fires callback on content change", () => {
    vi.useFakeTimers();
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(true);
    const textRegistry = createMockTextRegistry();

    const capability = new TextEditorOutlineCapability(
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    let callCount = 0;
    const disposable = capability.onSymbolsChanged(() => {
      callCount++;
    });

    editor._fireContentChange();
    vi.advanceTimersByTime(300);

    expect(callCount).toBe(1);

    disposable.dispose();
    vi.useRealTimers();
  });

  it("onSymbolsChanged debounces multiple content changes", () => {
    vi.useFakeTimers();
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(true);
    const textRegistry = createMockTextRegistry();

    const capability = new TextEditorOutlineCapability(
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    let callCount = 0;
    const disposable = capability.onSymbolsChanged(() => {
      callCount++;
    });

    editor._fireContentChange();
    vi.advanceTimersByTime(100);
    editor._fireContentChange();
    vi.advanceTimersByTime(100);
    editor._fireContentChange();
    vi.advanceTimersByTime(300);

    expect(callCount).toBe(1);

    disposable.dispose();
    vi.useRealTimers();
  });

  it("onSymbolsChanged stops firing after dispose", () => {
    vi.useFakeTimers();
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(true);
    const textRegistry = createMockTextRegistry();

    const capability = new TextEditorOutlineCapability(
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    let callCount = 0;
    const disposable = capability.onSymbolsChanged(() => {
      callCount++;
    });

    editor._fireContentChange();
    vi.advanceTimersByTime(300);
    expect(callCount).toBe(1);

    disposable.dispose();

    editor._fireContentChange();
    vi.advanceTimersByTime(300);
    expect(callCount).toBe(1);

    vi.useRealTimers();
  });
});

describe("createTextEditorHandle", () => {
  it("creates handle with outline capability when provider exists", () => {
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(true);
    const textRegistry = createMockTextRegistry();

    const handle = createTextEditorHandle(
      "test-editor",
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    expect(handle.editorId).toBe("test-editor");
    expect(handle.outline).toBeDefined();
  });

  it("creates handle with outline capability even when no provider - getSymbols returns empty", async () => {
    const editor = createMockEditorApi();
    const outlineRegistry = createMockOutlineRegistry(false);
    const textRegistry = createMockTextRegistry();

    const handle = createTextEditorHandle(
      "test-editor",
      editor as unknown as TextEditorApi,
      outlineRegistry as unknown as OutlineRegistry,
      textRegistry as unknown as TextEditorRegistry
    );

    expect(handle.editorId).toBe("test-editor");
    expect(handle.outline).toBeDefined();
    const symbols = await handle.outline!.getSymbols();
    expect(symbols).toEqual([]);
  });
});