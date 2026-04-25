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
  });

  it("maps valid configured settings", () => {
    const resolved = resolveEditorSettings(
      reader({
        "core.editor.fontSize": 16,
        "core.editor.fontFamily": "Fira Code",
        "core.editor.wordWrap": "on",
        "core.editor.tabSize": 2,
        "core.editor.insertSpaces": false,
        "core.editor.lineNumbers": "relative",
        "core.editor.minimap.enabled": false,
        "core.editor.renderWhitespace": "all",
        "core.editor.cursorBlinking": "smooth",
        "core.editor.formatOnSave": true
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
      formatOnSave: true
    });
  });

  it("falls back for invalid values", () => {
    const resolved = resolveEditorSettings(
      reader({
        "core.editor.fontSize": 100,
        "core.editor.wordWrap": "invalid",
        "core.editor.lineNumbers": "everywhere",
        "core.editor.renderWhitespace": "random",
        "core.editor.cursorBlinking": "beep"
      })
    );

    expect(resolved.fontSize).toBe(32);
    expect(resolved.wordWrap).toBe("off");
    expect(resolved.lineNumbers).toBe("on");
    expect(resolved.renderWhitespace).toBe("selection");
    expect(resolved.cursorBlinking).toBe("blink");
  });

  it("builds monaco options for create and update", () => {
    const source = reader({
      "core.editor.wordWrap": "wordWrapColumn",
      "core.editor.minimap.enabled": false,
      "core.editor.tabSize": 8
    });

    const createOptions = buildMonacoCreateOptions(source);
    const updateOptions = buildMonacoUpdateOptions(source);
    const modelUpdateOptions = buildMonacoModelUpdateOptions(source);

    expect(createOptions.wordWrap).toBe("wordWrapColumn");
    expect(createOptions.minimap).toEqual({ enabled: false });
    expect(createOptions.tabSize).toBe(8);
    expect(updateOptions.wordWrap).toBe("wordWrapColumn");
    expect(updateOptions.minimap).toEqual({ enabled: false });
    expect(modelUpdateOptions.tabSize).toBe(8);
  });
});
