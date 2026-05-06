import type { OutlineSymbol } from "../../../contracts/extensions/OutlineExtension";
import type {
  OutlineCapability,
  FormatCapability,
  ContentCapability,
  FocusCapability,
  SelectionCapability,
  EditorHandle
} from "../../../contracts/editor/EditorCapability";
import type { Disposable } from "../../../contracts/editor/EditorApi";
import type { TextEditorApi } from "./TextEditorApi";
import type { TextEditorRegistry } from "./TextEditorRegistry";
import type { OutlineRegistry } from "../../../contracts/extensions/OutlineExtension";

export class TextEditorOutlineCapability implements OutlineCapability {
  private readonly editor: TextEditorApi;
  private readonly outlineRegistry: OutlineRegistry;
  private readonly textRegistry: TextEditorRegistry;

  constructor(
    editor: TextEditorApi,
    outlineRegistry: OutlineRegistry,
    textRegistry: TextEditorRegistry
  ) {
    this.editor = editor;
    this.outlineRegistry = outlineRegistry;
    this.textRegistry = textRegistry;
  }

  getSymbols(): OutlineSymbol[] | Promise<OutlineSymbol[]> {
    const activeFile = this.textRegistry.getActiveFile();
    if (!activeFile) return [];
    const mimeType = activeFile.mimeType;
    if (!this.outlineRegistry.hasProvider(mimeType)) return [];
    const model = this.textRegistry.getModelForFile(activeFile.fileId ?? "");
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
}

export function createTextEditorHandle(
  editorId: string,
  editor: TextEditorApi,
  outlineRegistry: OutlineRegistry,
  textRegistry: TextEditorRegistry
): EditorHandle {
  const activeFile = textRegistry.getActiveFile();
  const outline = new TextEditorOutlineCapability(editor, outlineRegistry, textRegistry);
  const format = new TextEditorFormatCapability(editor);
  const content = new TextEditorContentCapability(editor);
  const focus = new TextEditorFocusCapability(editor);
  const selection = new TextEditorSelectionCapability(editor);
  return {
    editorId,
    fileId: activeFile?.fileId ?? null,
    outline,
    format,
    content,
    focus,
    selection
  };
}
