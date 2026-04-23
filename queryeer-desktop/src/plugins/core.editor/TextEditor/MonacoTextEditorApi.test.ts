import { describe, expect, it } from "vitest";
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
});
