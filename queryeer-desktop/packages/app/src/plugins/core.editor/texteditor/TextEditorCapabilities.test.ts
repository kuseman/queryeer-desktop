import { describe, expect, it, vi } from "vitest";
import type { TextEditorApi } from "./TextEditorApi";
import type { OutlineRegistry } from "@queryeer/api/extensions/OutlineExtension";
import type { TextEditorRegistry } from "./TextEditorRegistry";
import {
  TextEditorSelectionCapability,
  TextEditorVersionedTextEditCapability,
  createTextEditorHandle
} from "./TextEditorCapabilities";

describe("TextEditorVersionedTextEditCapability", () => {
  it("applies edits when the expected version matches", () => {
    let version = 7;
    const executeEdits = vi.fn(() => {
      version = 8;
      return true;
    });
    const pushUndoStop = vi.fn(() => true);
    const editor = {
      getVersionId: () => version,
      getLineCount: () => 1,
      getLineContent: () => "abcd",
      executeEdits,
      pushUndoStop
    } as unknown as TextEditorApi;
    const capability = new TextEditorVersionedTextEditCapability(editor);

    const result = capability.replaceRange(7, {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 5
    }, "text");

    expect(result).toEqual({ ok: true, version: 8 });
    expect(pushUndoStop).toHaveBeenCalledTimes(2);
    expect(executeEdits).toHaveBeenCalledWith([{
      type: "replace",
      range: {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 5
      },
      text: "text"
    }]);
  });

  it("rejects edits when the document version changed", () => {
    const executeEdits = vi.fn();
    const editor = {
      getVersionId: () => 9,
      getLineCount: () => 1,
      getLineContent: () => "abcd",
      executeEdits,
      pushUndoStop: vi.fn()
    } as unknown as TextEditorApi;
    const capability = new TextEditorVersionedTextEditCapability(editor);

    const result = capability.replaceRange(7, {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 5
    }, "text");

    expect(result).toEqual({
      ok: false,
      reason: "versionMismatch",
      expectedVersion: 7,
      actualVersion: 9
    });
    expect(executeEdits).not.toHaveBeenCalled();
  });

  it("normalizes CRLF text before applying edits", () => {
    const executeEdits = vi.fn(() => true);
    const editor = {
      getVersionId: () => 3,
      getLineCount: () => 1,
      getLineContent: () => "",
      executeEdits,
      pushUndoStop: vi.fn()
    } as unknown as TextEditorApi;
    const capability = new TextEditorVersionedTextEditCapability(editor);

    capability.replaceRange(3, {
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1
    }, "a\r\nb\rc");

    const calls = executeEdits.mock.calls as unknown as Array<[{ text: string }[]]>;
    expect(calls[0]?.[0][0]?.text).toBe("a\nb\nc");
  });

  it("rejects out-of-bounds ranges before Monaco can clamp them", () => {
    const executeEdits = vi.fn(() => true);
    const editor = {
      getVersionId: () => 1,
      getLineCount: () => 1,
      getLineContent: () => "    and vp.countryCode = 'SE'",
      executeEdits,
      pushUndoStop: vi.fn()
    } as unknown as TextEditorApi;
    const capability = new TextEditorVersionedTextEditCapability(editor);

    const result = capability.replaceRange(1, {
      startLineNumber: 1,
      startColumn: 36,
      endLineNumber: 1,
      endColumn: 47
    }, "'FI'");

    expect(result).toMatchObject({
      ok: false,
      reason: "invalidRange"
    });
    expect(executeEdits).not.toHaveBeenCalled();
  });

  it("notifies version changes from editor content changes", () => {
    const dispose = vi.fn();
    const onDidChangeModelContent = vi.fn((callback: (event: { versionId: number }) => void) => {
      callback({ versionId: 12 });
      return { dispose };
    });
    const editor = {
      getVersionId: () => 11,
      executeEdits: vi.fn(),
      pushUndoStop: vi.fn(),
      onDidChangeModelContent
    } as unknown as TextEditorApi;
    const capability = new TextEditorVersionedTextEditCapability(editor);
    const callback = vi.fn();

    const subscription = capability.onDidChangeVersion(callback);
    subscription.dispose();

    expect(callback).toHaveBeenCalledWith(12);
    expect(dispose).toHaveBeenCalled();
  });
});

describe("TextEditorSelectionCapability", () => {
  it("reads text from a supplied range", () => {
    const getText = vi.fn(() => "'SE'");
    const editor = {
      getModel: () => ({ getText }),
      getContent: () => "",
      getSelection: () => null,
      getSelectedText: () => null
    } as unknown as TextEditorApi;
    const capability = new TextEditorSelectionCapability(editor);
    const range = {
      startLineNumber: 1,
      startColumn: 26,
      endLineNumber: 1,
      endColumn: 30
    };

    expect(capability.getContentFromRange(range)).toBe("'SE'");
    expect(getText).toHaveBeenCalledWith(range);
  });
});

describe("createTextEditorHandle", () => {
  it("uses editor instance context for active file lookup", () => {
    const editor = {
      getContent: vi.fn(() => "select 1")
    } as unknown as TextEditorApi;
    const outlineRegistry = {
      hasProvider: vi.fn(() => false),
      getSymbols: vi.fn()
    } as unknown as OutlineRegistry;
    const textRegistry = {
      getActiveFile: vi.fn(() => ({ fileId: "active-file", mimeType: "application/sql" }))
    } as unknown as TextEditorRegistry;

    const handle = createTextEditorHandle(
      "core.editor.text",
      editor,
      outlineRegistry,
      textRegistry,
      { editorInstanceId: "group-1:core.editor.text", fileId: "file-explicit" }
    );

    expect((textRegistry as unknown as { getActiveFile: ReturnType<typeof vi.fn> }).getActiveFile)
      .toHaveBeenCalledWith("group-1:core.editor.text");
    expect(handle.fileId).toBe("file-explicit");
  });

  it("resolves outline symbols with explicit file context", async () => {
    const editor = {
      getContent: vi.fn(() => "")
    } as unknown as TextEditorApi;
    const outlineRegistry = {
      hasProvider: vi.fn(() => true),
      getSymbols: vi.fn(() => [])
    } as unknown as OutlineRegistry;
    const textRegistry = {
      getActiveFile: vi.fn(() => null),
      getModelForFile: vi.fn(() => ({
        getMimeType: () => "application/sql",
        getContent: () => "select 1"
      }))
    } as unknown as TextEditorRegistry;

    const handle = createTextEditorHandle(
      "core.editor.text",
      editor,
      outlineRegistry,
      textRegistry,
      { fileId: "file-target" }
    );

    await Promise.resolve(handle.outline?.getSymbols());

    expect((textRegistry as unknown as { getModelForFile: ReturnType<typeof vi.fn> }).getModelForFile)
      .toHaveBeenCalledWith("file-target");
    expect((outlineRegistry as unknown as { getSymbols: ReturnType<typeof vi.fn> }).getSymbols)
      .toHaveBeenCalledWith("application/sql", "select 1");
  });
});
