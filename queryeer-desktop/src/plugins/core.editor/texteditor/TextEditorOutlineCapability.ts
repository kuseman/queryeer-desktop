import type { OutlineSymbol } from "../../../contracts/extensions/OutlineExtension";
import type { OutlineCapability, EditorHandle } from "../../../contracts/editor/EditorCapability";
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

export function createTextEditorHandle(
  editorId: string,
  editor: TextEditorApi,
  outlineRegistry: OutlineRegistry,
  textRegistry: TextEditorRegistry
): EditorHandle {
  const activeFile = textRegistry.getActiveFile();
  const outline = new TextEditorOutlineCapability(editor, outlineRegistry, textRegistry);
  return { editorId, fileId: activeFile?.fileId ?? null, outline };
}