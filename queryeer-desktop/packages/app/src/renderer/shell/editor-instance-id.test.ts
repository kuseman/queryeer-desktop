import { describe, expect, it } from "vitest";
import { createEditorInstanceId } from "./editor-instance-id";

describe("createEditorInstanceId", () => {
  it("is stable for tab switches in same group/editor", () => {
    const id1 = createEditorInstanceId("editor-group-1", "core.editor.text");
    const id2 = createEditorInstanceId("editor-group-1", "core.editor.text");

    expect(id1).toBe(id2);
    expect(id1).toBe("editor-group-1:core.editor.text");
  });

  it("changes when editor type changes in same group", () => {
    const text = createEditorInstanceId("editor-group-1", "core.editor.text");
    const query = createEditorInstanceId("editor-group-1", "core.queryengine.editor");

    expect(text).not.toBe(query);
  });
});
