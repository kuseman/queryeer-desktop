import { describe, expect, it } from "vitest";
import {
  buildMonacoCreateOptions,
  buildMonacoModelUpdateOptions,
  buildMonacoUpdateOptions,
  resolveEditorSettings
} from "./editor-settings";

function reader(values: Record<string, unknown>) {
  return {
    getValue: (settingId: string) => values[settingId]
  };
}

describe("editor settings mapping", () => {
  it("uses defaults when settings are missing", () => {
    const resolved = resolveEditorSettings(null);

    expect(resolved.fontSize).toBe(13);
    expect(resolved.wordWrap).toBe("off");
    expect(resolved.minimapEnabled).toBe(true);
    expect(resolved.formatOnSave).toBe(false);
    expect(resolved.acceptSuggestionOnEnter).toBe("off");
  });

  it("maps valid configured settings", () => {
    const resolved = resolveEditorSettings(
      reader({
        "core.editor.texteditor.fontSize": 16,
        "core.editor.texteditor.fontFamily": "Fira Code",
        "core.editor.texteditor.wordWrap": "on",
        "core.editor.texteditor.tabSize": 2,
        "core.editor.texteditor.insertSpaces": false,
        "core.editor.texteditor.lineNumbers": "relative",
        "core.editor.texteditor.minimap.enabled": false,
        "core.editor.texteditor.renderWhitespace": "all",
        "core.editor.texteditor.cursorBlinking": "smooth",
        "core.editor.texteditor.formatOnSave": true,
        "core.editor.texteditor.acceptSuggestionOnEnter": "smart"
      })
    );

    expect(resolved).toMatchObject({
      fontSize: 16,
      fontFamily: "Fira Code",
      wordWrap: "on",
      tabSize: 2,
      insertSpaces: false,
      lineNumbers: "relative",
      minimapEnabled: false,
      renderWhitespace: "all",
      cursorBlinking: "smooth",
      formatOnSave: true,
      acceptSuggestionOnEnter: "smart"
    });
  });

  it("falls back for invalid values", () => {
    const resolved = resolveEditorSettings(
      reader({
        "core.editor.texteditor.fontSize": 100,
        "core.editor.texteditor.wordWrap": "invalid",
        "core.editor.texteditor.lineNumbers": "everywhere",
        "core.editor.texteditor.renderWhitespace": "random",
        "core.editor.texteditor.cursorBlinking": "beep",
        "core.editor.texteditor.acceptSuggestionOnEnter": "maybe"
      })
    );

    expect(resolved.fontSize).toBe(32);
    expect(resolved.wordWrap).toBe("off");
    expect(resolved.lineNumbers).toBe("on");
    expect(resolved.renderWhitespace).toBe("selection");
    expect(resolved.cursorBlinking).toBe("blink");
    expect(resolved.acceptSuggestionOnEnter).toBe("off");
  });

  it("builds monaco options for create and update", () => {
    const source = reader({
      "core.editor.texteditor.wordWrap": "wordWrapColumn",
      "core.editor.texteditor.minimap.enabled": false,
      "core.editor.texteditor.tabSize": 8
    });

    const createOptions = buildMonacoCreateOptions(source);
    const updateOptions = buildMonacoUpdateOptions(source);
    const modelUpdateOptions = buildMonacoModelUpdateOptions(source);

    expect(createOptions.wordWrap).toBe("wordWrapColumn");
    expect(createOptions.minimap).toEqual({ enabled: false });
    expect(createOptions.tabSize).toBe(8);
    expect(createOptions.fixedOverflowWidgets).toBe(true);
    expect(createOptions.acceptSuggestionOnEnter).toBe("off");
    expect(updateOptions.wordWrap).toBe("wordWrapColumn");
    expect(updateOptions.minimap).toEqual({ enabled: false });
    expect(updateOptions.acceptSuggestionOnEnter).toBe("off");
    expect(modelUpdateOptions.tabSize).toBe(8);
  });
});
