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

describe("MonacoTextEditorApi edit actions", () => {
  it("routes core edit operations through Monaco command ids", () => {
    const api = new MonacoTextEditorApi();
    const trigger = vi.fn();
    const focus = vi.fn();
    (api as unknown as { editor: unknown }).editor = { trigger, focus };

    api.undo();
    api.redo();
    api.cut();
    api.copy();
    api.paste();
    api.selectAll();

    expect(trigger).toHaveBeenNthCalledWith(1, "command", "undo", null);
    expect(trigger).toHaveBeenNthCalledWith(2, "command", "redo", null);
    expect(trigger).toHaveBeenNthCalledWith(3, "command", "editor.action.clipboardCutAction", null);
    expect(trigger).toHaveBeenNthCalledWith(4, "command", "editor.action.clipboardCopyAction", null);
    expect(trigger).toHaveBeenNthCalledWith(5, "command", "editor.action.clipboardPasteAction", null);
    expect(trigger).toHaveBeenNthCalledWith(6, "command", "editor.action.selectAll", null);
    expect(focus).toHaveBeenCalledTimes(6);
  });

  it("routes line operations through Monaco actions", () => {
    const api = new MonacoTextEditorApi();
    const run = vi.fn();
    const getAction = vi.fn(() => ({ run }));
    (api as unknown as { editor: unknown }).editor = { getAction };

    api.copyLineUp();
    expect(getAction).toHaveBeenCalledWith("editor.action.copyLinesUpAction");
    expect(run).toHaveBeenCalledTimes(1);

    api.copyLineDown();
    expect(getAction).toHaveBeenCalledWith("editor.action.copyLinesDownAction");

    api.moveLineUp();
    expect(getAction).toHaveBeenCalledWith("editor.action.moveLinesUpAction");

    api.moveLineDown();
    expect(getAction).toHaveBeenCalledWith("editor.action.moveLinesDownAction");

    api.joinLines();
    expect(getAction).toHaveBeenCalledWith("editor.action.joinLines");

    api.sortLinesAscending();
    expect(getAction).toHaveBeenCalledWith("editor.action.sortLinesAscending");

    api.sortLinesDescending();
    expect(getAction).toHaveBeenCalledWith("editor.action.sortLinesDescending");

    api.indentLines();
    expect(getAction).toHaveBeenCalledWith("editor.action.indentLines");

    api.outdentLines();
    expect(getAction).toHaveBeenCalledWith("editor.action.outdentLines");

    expect(run).toHaveBeenCalledTimes(9);
  });

  it("safely handles missing editor for line operations", () => {
    const api = new MonacoTextEditorApi();

    expect(() => {
      api.copyLineUp();
      api.copyLineDown();
      api.moveLineUp();
      api.moveLineDown();
      api.joinLines();
      api.sortLinesAscending();
      api.sortLinesDescending();
      api.indentLines();
      api.outdentLines();
    }).not.toThrow();
  });

  it("sets and clears line decorations per owner", () => {
    const api = new MonacoTextEditorApi();
    const deltaDecorations = vi
      .fn()
      .mockReturnValueOnce(["dec-1"])
      .mockReturnValueOnce([]);
    const editor = {
      getModel: () => ({
        getLineCount: () => 10,
        getLineMaxColumn: () => 20
      }),
      deltaDecorations
    };

    (api as unknown as { editor: unknown }).editor = editor;
    (api as unknown as { monaco: () => unknown }).monaco = () => ({
      Range: class {
        constructor(
          public startLineNumber: number,
          public startColumn: number,
          public endLineNumber: number,
          public endColumn: number
        ) {}
      }
    });

    api.setLineDecorations("owner-a", [{
      lineNumber: 2,
      className: "marker"
    }]);

    expect(deltaDecorations).toHaveBeenNthCalledWith(1, [], expect.any(Array));

    api.clearLineDecorations("owner-a");
    expect(deltaDecorations).toHaveBeenNthCalledWith(2, ["dec-1"], []);
  });

  it("sets and clears view zones by owner", () => {
    const api = new MonacoTextEditorApi();
    const removeZone = vi.fn();
    const addZone = vi.fn(() => "zone-1");
    const changeViewZones = vi.fn((callback: (accessor: { addZone: typeof addZone; removeZone: typeof removeZone }) => void) => {
      callback({ addZone, removeZone });
    });

    const editor = {
      getModel: () => ({
        getLineCount: () => 15
      }),
      changeViewZones
    };

    (api as unknown as { editor: unknown }).editor = editor;

    const node = document.createElement("div");
    api.setLineViewZone("owner-a", 8, node, 3);
    expect(addZone).toHaveBeenCalledTimes(1);
    expect(addZone).toHaveBeenCalledWith(expect.objectContaining({
      suppressMouseDown: false,
      domNode: node
    }));
    expect(node.style.pointerEvents).toBe("auto");
    expect(node.style.zIndex).toBe("2");

    api.clearLineViewZone("owner-a");
    expect(removeZone).toHaveBeenCalledWith("zone-1");
  });
});
