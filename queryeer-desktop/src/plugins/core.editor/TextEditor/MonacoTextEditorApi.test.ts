import { describe, expect, it, vi } from "vitest";
import { MonacoTextEditorApi } from "./MonacoTextEditorApi";

describe("MonacoTextEditorApi view state", () => {
  it("strips contribution state that can carry stale layout geometry", () => {
    const api = new MonacoTextEditorApi();
    const editor = {
      saveViewState: () => ({
        viewState: { scrollTop: 120 },
        cursorState: [{ inSelectionMode: false }],
        contributionsState: {
          "editor.contrib.viewZones": { zones: [{ id: "z1", afterLineNumber: 1 }] }
        }
      })
    };

    (api as unknown as { editor: unknown }).editor = editor;

    expect(api.getViewState()).toEqual({
      viewState: { scrollTop: 120 },
      cursorState: [{ inSelectionMode: false }]
    });
  });

  it("keeps non-monaco-shaped state untouched", () => {
    const api = new MonacoTextEditorApi();
    const customState = { foo: "bar" };
    const editor = {
      saveViewState: () => customState
    };

    (api as unknown as { editor: unknown }).editor = editor;

    expect(api.getViewState()).toBe(customState);
  });

  it("preserves active view state when replacing same-model content", () => {
    const api = new MonacoTextEditorApi();
    const savedState = { viewState: { scrollTop: 42 }, cursorState: [] };
    const restoreViewState = vi.fn();
    const setModel = vi.fn();
    const setValue = vi.fn();
    const existingModel = {
      uri: { toString: () => "file:///a.sql" },
      getValue: () => "before",
      setValue
    };
    const setSelection = vi.fn();
    const setPosition = vi.fn();
    const setScrollTop = vi.fn();
    const setScrollLeft = vi.fn();
    const editor = {
      getModel: () => existingModel,
      saveViewState: () => savedState,
      restoreViewState,
      setModel,
      getSelection: () => ({ startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 5 }),
      getPosition: () => ({ lineNumber: 3, column: 5 }),
      getScrollTop: () => 120,
      getScrollLeft: () => 12,
      setSelection,
      setPosition,
      setScrollTop,
      setScrollLeft
    };

    const modelStore = new Map<string, { getValue: () => string; setValue: (v: string) => void }>();
    modelStore.set(
      "file:///a.sql",
      existingModel as unknown as { getValue: () => string; setValue: (v: string) => void }
    );

    (api as unknown as { editor: unknown }).editor = editor;
    (api as unknown as { monaco: () => unknown }).monaco = () => ({
      Uri: { parse: (uri: string) => uri },
      editor: {
        getModel: (uri: string) => modelStore.get(uri) ?? null,
        createModel: vi.fn()
      }
    });

    api.setModel({
      uri: "file:///a.sql",
      languageId: "sql",
      getText: () => "after",
      lineCount: 1,
      lineAt: () => ({
        lineNumber: 1,
        text: "after",
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }
      })
    });

    expect(restoreViewState).toHaveBeenCalledWith(savedState);
    expect(setModel).not.toHaveBeenCalled();
    expect(setValue).toHaveBeenCalledWith("after");
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setScrollTop).toHaveBeenCalledWith(120);
    expect(setScrollLeft).toHaveBeenCalledWith(12);
  });
});
