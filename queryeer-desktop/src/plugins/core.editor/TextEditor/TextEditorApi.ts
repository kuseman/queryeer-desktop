import type {
  TextDocument,
  TextRange,
  Position,
  Selection,
  Disposable,
  TextEditorEditOperation,
  FindOptions,
  EditorOptions,
  RevealType,
  WordAtPosition,
  ModelContentChangedEvent,
  CursorPositionChangedEvent,
  CursorSelectionChangedEvent,
  KeyDownEvent,
  EditorLayoutInfo,
  EditorMouseEvent
} from "./types";

export abstract class TextEditorApi {
  abstract getModel(): TextDocument | null;
  abstract setModel(model: TextDocument | null): void;

  abstract getPosition(): Position | null;
  abstract setPosition(position: Position, revealType?: RevealType): void;

  abstract getSelection(): Selection | null;
  abstract setSelection(selection: Selection): void;
  abstract revealLine(lineNumber: number, revealType?: RevealType): void;
  abstract revealLineInCenter(lineNumber: number): void;
  abstract revealPositionInCenter(position: Position): void;
  abstract revealRange(range: TextRange, revealType?: RevealType): void;

  abstract getWordAtPosition(position: Position): WordAtPosition | null;
  abstract getWordUntilPosition(position: Position, maxLength?: number): WordAtPosition | null;

  abstract getContent(): string;
  abstract getLineContent(lineNumber: number): string;
  abstract getLineCount(): number;
  abstract getOffsetForPosition(lineNumber: number, column: number): number;
  abstract getPositionAt(offset: number): Position;

  abstract executeEdits(operations: TextEditorEditOperation[]): boolean;
  abstract applyEdits(edits: { range: TextRange; newText: string }[]): boolean;

  abstract insertSnippet(text: string, range?: TextRange): boolean;
  abstract insertSnippetAtCursor(text: string): boolean;

  abstract toggleCommentLine(): void;
  abstract addCommentLine(): void;
  abstract removeCommentLine(): void;

  abstract format(): Promise<void>;
  abstract formatRange(range: TextRange): Promise<void>;
  abstract formatOnPaste(): Promise<void>;

  abstract goToDefinition(): Promise<void>;
  abstract peekDefinition(): Promise<void>;
  abstract goToTypeDefinition(): Promise<void>;
  abstract goToImplementation(): Promise<void>;
  abstract peekImplementation(): Promise<void>;
  abstract findReferences(): Promise<void>;

  abstract find(searchString: string): void;
  abstract findNext(searchString: string): void;
  abstract findPrevious(searchString: string): void;
  abstract findWithOptions(options: FindOptions): void;
  abstract closeFindWidget(): void;

  abstract updateOptions(options: EditorOptions): void;

  abstract undo(): void;
  abstract redo(): void;
  abstract cut(): void;
  abstract copy(): void;
  abstract paste(): void;
  abstract selectAll(): void;

  abstract pushUndoStop(): boolean;
  abstract popUndoStop(): boolean;

  abstract getVisibleColumnFromMouseEvent(e: unknown): number;

  abstract getViewState(): unknown;
  abstract setViewState(state: unknown): void;

  abstract getCursorState(): { position: Position; selection: Selection } | undefined;

  getSelectedText(): string | null {
    const sel = this.getSelection();
    if (!sel) return null;
    const startLine = Math.min(sel.selectionStartLineNumber, sel.positionLineNumber);
    const endLine = Math.max(sel.selectionStartLineNumber, sel.positionLineNumber);
    const startCol =
      startLine === sel.selectionStartLineNumber ? sel.selectionStartColumn : sel.positionColumn;
    const endCol =
      endLine === sel.positionLineNumber ? sel.positionColumn : sel.selectionStartColumn;
    if (startLine === endLine && startCol === endCol) return null;
    return this.getModel()?.getText({ startLineNumber: startLine, startColumn: startCol, endLineNumber: endLine, endColumn: endCol }) ?? null;
  }

  abstract onDidChangeModelContent(callback: (event: ModelContentChangedEvent) => void): Disposable;
  abstract onDidChangeCursorPosition(callback: (event: CursorPositionChangedEvent) => void): Disposable;
  abstract onDidChangeCursorSelection(callback: (event: CursorSelectionChangedEvent) => void): Disposable;
  abstract onDidFocusEditorText(callback: () => void): Disposable;
  abstract onDidBlurEditorText(callback: () => void): Disposable;
  abstract onDidFocusEditorWidget(callback: () => void): Disposable;
  abstract onDidBlurEditorWidget(callback: () => void): Disposable;
  abstract onWillFireBeforeKeydown(callback: (event: KeyDownEvent) => boolean | void): Disposable;
  abstract onDidFireAfterKeydown(callback: (event: KeyDownEvent) => void): Disposable;
  abstract onBeforeRender(callback: () => void): Disposable;
  abstract onDidLayoutChange(callback: (layoutInfo: EditorLayoutInfo) => void): Disposable;
  abstract onMouseDown(callback: (event: EditorMouseEvent) => void): Disposable;
  abstract onMouseUp(callback: (event: EditorMouseEvent) => void): Disposable;

  abstract layout(width: number, height: number): void;
  abstract focus(): void;
  abstract hasTextFocus(): boolean;
  abstract hasWidgetFocus(): boolean;
  abstract dispose(): void;
}
