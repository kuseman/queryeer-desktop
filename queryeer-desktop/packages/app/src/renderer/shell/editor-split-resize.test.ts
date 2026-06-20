import { describe, expect, it } from "vitest";
import { applyEditorGroupSizePreview, getEditorGroupElements } from "./editor-split-resize";

describe("editor split resize preview", () => {
  it("updates group flex sizes directly for resize preview", () => {
    const container = document.createElement("div");
    const left = document.createElement("div");
    const right = document.createElement("div");
    left.className = "shell-editor-group";
    right.className = "shell-editor-group";
    container.append(left, right);

    const groups = getEditorGroupElements(container);
    applyEditorGroupSizePreview(groups, [0.7, 0.3]);

    expect(groups).toEqual([left, right]);
    expect(left.style.flexGrow).toBe("0.7");
    expect(right.style.flexGrow).toBe("0.3");
  });
});
