import { describe, expect, it, vi } from "vitest";
import type { TextEditorApi } from "./TextEditorApi";
import { TextEditorSelectionCapability, TextEditorVersionedTextEditCapability } from "./TextEditorCapabilities";

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
