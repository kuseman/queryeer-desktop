import type { OutlineSymbol } from "@queryeer/api/extensions/OutlineExtension";
import type {
  OutlineCapability,
  FormatCapability,
  ContentCapability,
  FocusCapability,
  SelectionCapability,
  VersionedTextEditCapability,
  VersionedTextEditResult,
  EditorHandle
} from "@queryeer/api/editor/EditorCapability";
import type { Disposable, TextRange } from "@queryeer/api/editor/EditorApi";
import type { TextEditorApi } from "./TextEditorApi";
import type { TextEditorRegistry } from "./TextEditorRegistry";
import type { OutlineRegistry } from "@queryeer/api/extensions/OutlineExtension";

type TextEditorHandleContext = {
  editorInstanceId?: string;
  fileId?: string | null;
};

export class TextEditorOutlineCapability implements OutlineCapability {
  private readonly editor: TextEditorApi;
  private readonly outlineRegistry: OutlineRegistry;
  private readonly textRegistry: TextEditorRegistry;
  private readonly context: TextEditorHandleContext;

  constructor(
    editor: TextEditorApi,
    outlineRegistry: OutlineRegistry,
    textRegistry: TextEditorRegistry,
    context: TextEditorHandleContext = {}
  ) {
    this.editor = editor;
    this.outlineRegistry = outlineRegistry;
    this.textRegistry = textRegistry;
    this.context = context;
  }

  getSymbols(): OutlineSymbol[] | Promise<OutlineSymbol[]> {
    const activeFile = this.textRegistry.getActiveFile(this.context.editorInstanceId);
    const fileId = this.context.fileId ?? activeFile?.fileId ?? null;
    if (!fileId) return [];
    const model = this.textRegistry.getModelForFile(fileId);
    const mimeType = activeFile?.mimeType ?? model?.getMimeType();
    if (!mimeType) return [];
    if (!this.outlineRegistry.hasProvider(mimeType)) return [];
    const content = this.normalizeContent(
      this.editor.getContent() || model?.getContent() || ""
    );
    return this.outlineRegistry.getSymbols(mimeType, content);
  }

  revealSymbol(symbol: OutlineSymbol): void {
    this.editor.revealLine(symbol.selectionRange.startLineNumber, "top");
    this.editor.setPosition({
      lineNumber: symbol.selectionRange.startLineNumber,
      column: symbol.selectionRange.startColumn
    });
  }

  onSymbolsChanged(callback: () => void): Disposable {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const disposable = this.editor.onDidChangeModelContent(() => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        timer = null;
        callback();
      }, 300);
    });
    return {
      dispose: () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        disposable.dispose();
      }
    };
  }

  private normalizeContent(content: string): string {
    return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  }
}

export class TextEditorFormatCapability implements FormatCapability {
  private readonly editor: TextEditorApi;

  constructor(editor: TextEditorApi) {
    this.editor = editor;
  }

  format(): Promise<void> {
    return this.editor.format();
  }
}

export class TextEditorContentCapability implements ContentCapability {
  private readonly editor: TextEditorApi;

  constructor(editor: TextEditorApi) {
    this.editor = editor;
  }

  getContent(): string {
    return this.editor.getContent();
  }

  setContent(content: string): void {
    const model = this.editor.getModel();
    if (model) {
      this.editor.executeEdits([
        {
          type: "replace",
          range: {
            startLineNumber: 1,
            startColumn: 1,
            endLineNumber: model.lineCount,
            endColumn: model.lineAt(model.lineCount).text.length + 1
          },
          text: content
        }
      ]);
    }
  }
}

export class TextEditorFocusCapability implements FocusCapability {
  private readonly editor: TextEditorApi;

  constructor(editor: TextEditorApi) {
    this.editor = editor;
  }

  focus(): void {
    this.editor.focus();
  }
}

export class TextEditorSelectionCapability implements SelectionCapability {
  private readonly editor: TextEditorApi;

  constructor(editor: TextEditorApi) {
    this.editor = editor;
  }

  getSelectedText(): string | null {
    return this.editor.getSelectedText();
  }

  getContent(): string {
    return this.editor.getContent();
  }

  getContentFromRange(range: TextRange): string | undefined {
    return this.editor.getModel()?.getText(range);
  }

  getSelection(): {
    selectionStartLineNumber: number;
    selectionStartColumn: number;
    positionLineNumber: number;
    positionColumn: number;
  } | null {
    return this.editor.getSelection();
  }
}

export class TextEditorVersionedTextEditCapability implements VersionedTextEditCapability {
  private readonly editor: TextEditorApi;

  constructor(editor: TextEditorApi) {
    this.editor = editor;
  }

  getVersionId(): number {
    return this.editor.getVersionId();
  }

  replaceRange(expectedVersion: number, range: TextRange, text: string): VersionedTextEditResult {
    const actualVersion = this.editor.getVersionId();
    if (actualVersion !== expectedVersion) {
      return { ok: false, reason: "versionMismatch", expectedVersion, actualVersion };
    }
    const rangeValidation = validateRange(this.editor, range);
    if (!rangeValidation.ok) {
      return { ok: false, reason: "invalidRange", message: rangeValidation.message, actualVersion };
    }
    this.editor.pushUndoStop();
    const applied = this.editor.executeEdits([{ type: "replace", range, text: normalizeEditText(text) }]);
    this.editor.pushUndoStop();
    if (!applied) {
      return { ok: false, reason: "editFailed", actualVersion };
    }
    return { ok: true, version: this.editor.getVersionId() };
  }

  onDidChangeVersion(callback: (version: number) => void): Disposable {
    return this.editor.onDidChangeModelContent((event) => {
      callback(event.versionId);
    });
  }
}

function normalizeEditText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function validateRange(editor: TextEditorApi, range: TextRange): { ok: true } | { ok: false; message: string } {
  const lineCount = editor.getLineCount();
  if (range.startLineNumber < 1 || range.endLineNumber < 1 || range.startLineNumber > lineCount || range.endLineNumber > lineCount) {
    return { ok: false, message: `Range lines must be within 1-${lineCount}` };
  }
  if (range.startLineNumber > range.endLineNumber) {
    return { ok: false, message: "Range start line must be before end line" };
  }
  if (range.startLineNumber === range.endLineNumber && range.startColumn > range.endColumn) {
    return { ok: false, message: "Range start column must be before end column" };
  }
  const startMaxColumn = editor.getLineContent(range.startLineNumber).length + 1;
  const endMaxColumn = editor.getLineContent(range.endLineNumber).length + 1;
  if (range.startColumn < 1 || range.startColumn > startMaxColumn) {
    return { ok: false, message: `Range start column must be within 1-${startMaxColumn}` };
  }
  if (range.endColumn < 1 || range.endColumn > endMaxColumn) {
    return { ok: false, message: `Range end column must be within 1-${endMaxColumn}` };
  }
  return { ok: true };
}

export function createTextEditorHandle(
  editorId: string,
  editor: TextEditorApi,
  outlineRegistry: OutlineRegistry,
  textRegistry: TextEditorRegistry,
  context: TextEditorHandleContext = {}
): EditorHandle {
  const activeFile = textRegistry.getActiveFile(context.editorInstanceId);
  const fileId = context.fileId ?? activeFile?.fileId ?? null;
  const outline = new TextEditorOutlineCapability(editor, outlineRegistry, textRegistry, context);
  const format = new TextEditorFormatCapability(editor);
  const content = new TextEditorContentCapability(editor);
  const focus = new TextEditorFocusCapability(editor);
  const selection = new TextEditorSelectionCapability(editor);
  const versionedTextEdit = new TextEditorVersionedTextEditCapability(editor);
  return {
    editorId,
    fileId,
    outline,
    format,
    content,
    focus,
    selection,
    versionedTextEdit
  };
}
