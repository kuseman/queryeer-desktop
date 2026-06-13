import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { LayoutEditorContribution } from "@queryeer/api/extensions/LayoutExtension";
import { EditorPane } from "./EditorPane";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///query.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("EditorPane", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    (globalThis as unknown as { React: typeof React }).React = React;
    rootElement = document.createElement("div");
    document.body.append(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("passes editor instance context to editor contributions", () => {
    const render = vi.fn(() => <div>Editor</div>);
    const activeEditor: LayoutEditorContribution = {
      id: "core.editor.test",
      title: "Test Editor",
      render
    };

    act(() => {
      root.render(
        <EditorPane
          activeFile={makeFile()}
          activeEditor={activeEditor}
          editorInstanceContext={{
            editorInstanceId: "editor-group-2:core.editor.test:file-1",
            editorGroupId: "editor-group-2",
            editorGroupIndex: 1,
            editorGroupCount: 2,
            isActiveEditorGroup: true
          }}
          welcomes={[]}
        />
      );
    });

    expect(render).toHaveBeenCalledWith(expect.objectContaining({
      activeFile: expect.objectContaining({ fileId: "file-1" }),
      editorInstanceId: "editor-group-2:core.editor.test:file-1",
      editorGroupId: "editor-group-2",
      editorGroupIndex: 1,
      editorGroupCount: 2,
      isActiveEditorGroup: true
    }));
    expect(rootElement.querySelector(".shell-editor-pane")?.getAttribute("data-editor-instance-id"))
      .toBe("editor-group-2:core.editor.test:file-1");
  });
});
