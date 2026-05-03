import type * as monacoType from "monaco-editor";
import type {
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
import { TextEditorApi } from "./TextEditorApi";

let monacoModule: typeof monacoType | null = null;

async function getMonaco(): Promise<typeof monacoType> {
  if (!monacoModule) {
    monacoModule = await import("monaco-editor");
  }
  return monacoModule;
}

export async function preloadMonaco(): Promise<void> {
  await getMonaco();
}

function getMonacoFast(): typeof monacoType | null {
  return monacoModule;
}

export class MonacoTextEditorApi extends TextEditorApi {
  private editor: monacoType.editor.IStandaloneCodeEditor | null = null;

  private sanitizeViewState(state: unknown): unknown {
    if (!state || typeof state !== "object") {
      return state;
    }
    const record = state as Record<string, unknown>;
    if (!("viewState" in record) || !("cursorState" in record)) {
      return state;
    }
    return {
      viewState: record.viewState,
      cursorState: record.cursorState
    };
  }

  constructor() {
    super();
  }

  attach(editor: monacoType.editor.IStandaloneCodeEditor): void {
    this.editor = editor;
  }

  detach(): void {
    this.editor = null;
  }

  private monaco(): typeof monacoType {
    const m = getMonacoFast();
    if (!m) throw new Error("Monaco not loaded");
    return m;
  }

  getModel() {
    const model = this.editor?.getModel();
    if (!model) return null;
    const monaco = this.monaco();
    return {
      uri: model.uri.toString(),
      languageId: model.getLanguageId(),
      getText: (range?: TextRange) => {
        if (!range) return model.getValue();
        const monacoRange = new monaco.Range(
          range.startLineNumber,
          range.startColumn,
          range.endLineNumber,
          range.endColumn
        );
        return model.getValueInRange(monacoRange);
      },
      lineCount: model.getLineCount(),
      lineAt: (lineNumber: number) => {
        const line = model.getLineContent(lineNumber);
        return {
          lineNumber,
          text: line,
          range: {
            startLineNumber: lineNumber,
            startColumn: 1,
            endLineNumber: lineNumber,
            endColumn: line.length + 1
          }
        };
      }
    };
  }

  setModel(model: ReturnType<typeof this.getModel>): void {
    if (!this.editor) return;
    if (!model) {
      this.editor.setModel(null);
      return;
    }
    const monaco = this.monaco();
    const currentModel = this.editor.getModel();
    let viewStateToRestore: unknown | null = null;
    let fallbackSelection: monacoType.Selection | null = null;
    let fallbackPosition: monacoType.Position | null = null;
    let fallbackScrollTop: number | null = null;
    let fallbackScrollLeft: number | null = null;
    let monacoModel = monaco.editor.getModel(monaco.Uri.parse(model.uri));
    if (!monacoModel) {
      monacoModel = monaco.editor.createModel(model.getText(), model.languageId, monaco.Uri.parse(model.uri));
    } else {
      const nextValue = model.getText();
      if (monacoModel.getValue() !== nextValue) {
        if (currentModel === monacoModel) {
          viewStateToRestore = this.editor.saveViewState();
          fallbackSelection = this.editor.getSelection();
          fallbackPosition = this.editor.getPosition();
          fallbackScrollTop = this.editor.getScrollTop();
          fallbackScrollLeft = this.editor.getScrollLeft();
        }
        monacoModel.setValue(nextValue);
      }
    }
    if (currentModel !== monacoModel) {
      this.editor.setModel(monacoModel);
    }
    if (viewStateToRestore) {
      this.editor.restoreViewState(viewStateToRestore as monacoType.editor.ICodeEditorViewState);
    }
    if (fallbackSelection || fallbackPosition || fallbackScrollTop !== null || fallbackScrollLeft !== null) {
      if (fallbackSelection) {
        this.editor.setSelection(fallbackSelection);
      } else if (fallbackPosition) {
        this.editor.setPosition(fallbackPosition);
      }
      if (fallbackScrollTop !== null) {
        this.editor.setScrollTop(fallbackScrollTop);
      }
      if (fallbackScrollLeft !== null) {
        this.editor.setScrollLeft(fallbackScrollLeft);
      }
    }
  }

  getPosition(): Position | null {
    const pos = this.editor?.getPosition();
    if (!pos) return null;
    return { lineNumber: pos.lineNumber, column: pos.column };
  }

  setPosition(position: Position, revealType: RevealType = "default"): void {
    if (!this.editor) return;
    const monaco = this.monaco();
    this.editor.setPosition(position);
    const scrollType = revealType === "center" || revealType === "centerIfOutsideViewport"
      ? monaco.editor.ScrollType.Smooth
      : monaco.editor.ScrollType.Immediate;
    if (revealType === "center") {
      this.editor.revealPositionInCenter(position, scrollType);
    } else if (revealType === "centerIfOutsideViewport") {
      this.editor.revealPositionInCenterIfOutsideViewport(position, scrollType);
    } else if (revealType === "top") {
      this.editor.revealPositionNearTop(position, scrollType);
    }
  }

  getSelection(): Selection | null {
    const sel = this.editor?.getSelection();
    if (!sel) return null;
    return {
      selectionStartLineNumber: sel.selectionStartLineNumber,
      selectionStartColumn: sel.selectionStartColumn,
      positionLineNumber: sel.positionLineNumber,
      positionColumn: sel.positionColumn
    };
  }

  setSelection(selection: Selection): void {
    if (!this.editor) return;
    this.editor.setSelection(selection);
  }

  revealLine(lineNumber: number, revealType: RevealType = "default"): void {
    if (!this.editor) return;
    const monaco = this.monaco();
    const scrollType = monaco.editor.ScrollType.Immediate;
    if (revealType === "center") {
      this.editor.revealLineInCenter(lineNumber, scrollType);
    } else if (revealType === "centerIfOutsideViewport") {
      this.editor.revealLineInCenterIfOutsideViewport(lineNumber, scrollType);
    } else if (revealType === "top") {
      const lineHeight = this.editor.getOption(monaco.editor.EditorOption.lineHeight);
      const targetScrollTop = (lineNumber - 1) * lineHeight;
      this.editor.setScrollTop(targetScrollTop, scrollType);
    } else {
      this.editor.revealLine(lineNumber, scrollType);
    }
  }

  revealLineInCenter(lineNumber: number): void {
    if (!this.editor) return;
    const monaco = this.monaco();
    this.editor.revealLineInCenter(lineNumber, monaco.editor.ScrollType.Smooth);
  }

  revealPositionInCenter(position: Position): void {
    if (!this.editor) return;
    const monaco = this.monaco();
    this.editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth);
  }

  revealRange(range: TextRange, _revealType: RevealType = "default"): void {
    if (!this.editor) return;
    const monaco = this.monaco();
    const monacoRange = new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
    this.editor.revealRangeInCenter(monacoRange, monaco.editor.ScrollType.Smooth);
  }

  getWordAtPosition(position: Position): WordAtPosition | null {
    const model = this.editor?.getModel();
    if (!model) return null;
    const wordInfo = model.getWordAtPosition(position);
    if (!wordInfo) return null;
    return { word: wordInfo.word, startColumn: wordInfo.startColumn, endColumn: wordInfo.endColumn };
  }

  getWordUntilPosition(position: Position, _maxLength = 100): WordAtPosition | null {
    return this.getWordAtPosition(position);
  }

  getContent(): string {
    return this.editor?.getValue() ?? "";
  }

  getLineContent(lineNumber: number): string {
    const model = this.editor?.getModel();
    return model?.getLineContent(lineNumber) ?? "";
  }

  getLineCount(): number {
    return this.editor?.getModel()?.getLineCount() ?? 0;
  }

  getOffsetForPosition(lineNumber: number, column: number): number {
    const model = this.editor?.getModel();
    if (!model) return 0;
    return model.getOffsetAt({ lineNumber, column });
  }

  getPositionAt(offset: number): Position {
    const model = this.editor?.getModel();
    if (!model) return { lineNumber: 1, column: 1 };
    const pos = model.getPositionAt(offset);
    return { lineNumber: pos.lineNumber, column: pos.column };
  }

  executeEdits(operations: TextEditorEditOperation[]): boolean {
    if (!this.editor) return false;
    const monaco = this.monaco();
    const edits: monacoType.editor.IIdentifiedSingleEditOperation[] = operations.map((op) => {
      if (op.type === "insert") {
        return { range: new monaco.Range(op.position.lineNumber, op.position.column, op.position.lineNumber, op.position.column), text: op.text };
      }
      if (op.type === "delete") {
        return { range: new monaco.Range(op.range.startLineNumber, op.range.startColumn, op.range.endLineNumber, op.range.endColumn), text: "" };
      }
      return { range: new monaco.Range(op.range.startLineNumber, op.range.startColumn, op.range.endLineNumber, op.range.endColumn), text: op.text };
    });
    return this.editor.executeEdits("", edits);
  }

  applyEdits(edits: { range: TextRange; newText: string }[]): boolean {
    if (!this.editor) return false;
    const monaco = this.monaco();
    const monacoEdits: monacoType.editor.IIdentifiedSingleEditOperation[] = edits.map((edit) => ({
      range: new monaco.Range(edit.range.startLineNumber, edit.range.startColumn, edit.range.endLineNumber, edit.range.endColumn),
      text: edit.newText
    }));
    return this.editor.executeEdits("", monacoEdits);
  }

  insertSnippet(text: string, range?: TextRange): boolean {
    if (!this.editor) return false;
    const monaco = this.monaco();
    if (range) {
      return this.editor.executeEdits("", [{
        range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
        text
      }]);
    }
    this.editor.trigger("snippet", "editor.action.insertSnippet", { text });
    return true;
  }

  insertSnippetAtCursor(text: string): boolean {
    if (!this.editor) return false;
    this.editor.trigger("snippet", "editor.action.insertSnippet", { text });
    return true;
  }

  toggleCommentLine(): void {
    if (!this.editor) return;
    this.editor.trigger("command", "editor.action.commentLine", null);
  }

  addCommentLine(): void {
    if (!this.editor) return;
    this.editor.trigger("command", "editor.action.addCommentLine", null);
  }

  removeCommentLine(): void {
    if (!this.editor) return;
    this.editor.trigger("command", "editor.action.removeCommentLine", null);
  }

  async format(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.formatDocument")?.run();
  }

  async formatRange(range: TextRange): Promise<void> {
    if (!this.editor) return;
    const action = this.editor.getAction("editor.action.formatSelection");
    if (action) {
      this.editor.setSelection(range);
      await action.run();
    }
  }

  async formatOnPaste(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.formatOnPaste")?.run();
  }

  async goToDefinition(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.goToDefinition")?.run();
  }

  async peekDefinition(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.peekDefinition")?.run();
  }

  async goToTypeDefinition(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.goToTypeDefinition")?.run();
  }

  async goToImplementation(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.goToImplementation")?.run();
  }

  async peekImplementation(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.peekImplementation")?.run();
  }

  async findReferences(): Promise<void> {
    if (!this.editor) return;
    this.editor.getAction("editor.action.findReferences")?.run();
  }

  find(_searchString: string): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger("keyboard", "actions.find", null);
  }

  findNext(_searchString: string): void {
    if (!this.editor) return;
    this.editor.getAction("editor.action.findNextSearch")?.run();
  }

  findPrevious(_searchString: string): void {
    if (!this.editor) return;
    this.editor.getAction("editor.action.findPreviousSearch")?.run();
  }

  findWithOptions(_options: FindOptions): void {
    if (!this.editor) return;
    this.editor.getAction("actions.find")?.run();
  }

  closeFindWidget(): void {
    if (!this.editor) return;
    this.editor.getAction("editor.action.closeFindWidget")?.run();
  }

  updateOptions(options: EditorOptions): void {
    this.editor?.updateOptions(options as monacoType.editor.IStandaloneEditorConstructionOptions);
  }

  undo(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger("command", "undo", null);
  }

  redo(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger("command", "redo", null);
  }

  cut(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger("command", "editor.action.clipboardCutAction", null);
  }

  copy(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger("command", "editor.action.clipboardCopyAction", null);
  }

  paste(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger("command", "editor.action.clipboardPasteAction", null);
  }

  selectAll(): void {
    if (!this.editor) return;
    this.editor.focus();
    this.editor.trigger("command", "editor.action.selectAll", null);
  }

  pushUndoStop(): boolean {
    if (!this.editor) return false;
    return this.editor.pushUndoStop();
  }

  popUndoStop(): boolean {
    if (!this.editor) return false;
    return this.editor.popUndoStop();
  }

  getVisibleColumnFromMouseEvent(_e: unknown): number {
    const pos = this.getPosition();
    return pos?.column ?? 1;
  }

  getViewState(): unknown {
    return this.sanitizeViewState(this.editor?.saveViewState() ?? null);
  }

  setViewState(state: unknown): void {
    if (this.editor && state) {
      this.editor.restoreViewState(state as monacoType.editor.ICodeEditorViewState);
    }
  }

  getCursorState() {
    const pos = this.getPosition();
    const sel = this.getSelection();
    if (!pos || !sel) return undefined;
    return { position: pos, selection: sel };
  }

  onDidChangeModelContent(callback: (event: ModelContentChangedEvent) => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    const d = this.editor.onDidChangeModelContent((e) => {
      callback({
        changes: e.changes.map((c) => ({
          range: {
            startLineNumber: c.range.startLineNumber,
            startColumn: c.range.startColumn,
            endLineNumber: c.range.endLineNumber,
            endColumn: c.range.endColumn
          },
          rangeLength: c.rangeLength,
          text: c.text
        })),
        eol: e.eol,
        isFlush: e.isFlush,
        isRedo: false,
        isUndo: false,
        versionId: e.versionId
      });
    });
    return { dispose: () => d.dispose() };
  }

  onDidChangeCursorPosition(callback: (event: CursorPositionChangedEvent) => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    const d = this.editor.onDidChangeCursorPosition((e) => {
      callback({
        position: { lineNumber: e.position.lineNumber, column: e.position.column },
        reason: e.reason as unknown as CursorPositionChangedEvent["reason"]
      });
    });
    return { dispose: () => d.dispose() };
  }

  onDidChangeCursorSelection(callback: (event: CursorSelectionChangedEvent) => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    const d = this.editor.onDidChangeCursorSelection((e) => {
      callback({
        selection: {
          selectionStartLineNumber: e.selection.selectionStartLineNumber,
          selectionStartColumn: e.selection.selectionStartColumn,
          positionLineNumber: e.selection.positionLineNumber,
          positionColumn: e.selection.positionColumn
        },
        source: e.source,
        reason: e.reason as unknown as CursorSelectionChangedEvent["reason"]
      });
    });
    return { dispose: () => d.dispose() };
  }

  onDidFocusEditorText(callback: () => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    if (typeof this.editor.onDidFocusEditorText !== "function") {
      return { dispose: () => {} };
    }
    const d = this.editor.onDidFocusEditorText(callback);
    return { dispose: () => d.dispose() };
  }

  onDidBlurEditorText(callback: () => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    if (typeof this.editor.onDidBlurEditorText !== "function") {
      return { dispose: () => {} };
    }
    const d = this.editor.onDidBlurEditorText(callback);
    return { dispose: () => d.dispose() };
  }

  onDidFocusEditorWidget(callback: () => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    if (typeof this.editor.onDidFocusEditorWidget !== "function") {
      return { dispose: () => {} };
    }
    const d = this.editor.onDidFocusEditorWidget(callback);
    return { dispose: () => d.dispose() };
  }

  onDidBlurEditorWidget(callback: () => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    if (typeof this.editor.onDidBlurEditorWidget !== "function") {
      return { dispose: () => {} };
    }
    const d = this.editor.onDidBlurEditorWidget(callback);
    return { dispose: () => d.dispose() };
  }

  onWillFireBeforeKeydown(_callback: (event: KeyDownEvent) => boolean | void): Disposable {
    return { dispose: () => {} };
  }

  onDidFireAfterKeydown(callback: (event: KeyDownEvent) => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    const d = this.editor.onKeyDown((e) => {
      callback({
        code: e.browserEvent.code,
        key: e.browserEvent.key,
        keyCode: e.keyCode,
        ctrlKey: e.browserEvent.ctrlKey,
        shiftKey: e.browserEvent.shiftKey,
        altKey: e.browserEvent.altKey,
        metaKey: e.browserEvent.metaKey
      });
    });
    return { dispose: () => d.dispose() };
  }

  onBeforeRender(_callback: () => void): Disposable {
    return { dispose: () => {} };
  }

  onDidLayoutChange(callback: (layoutInfo: EditorLayoutInfo) => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    const d = this.editor.onDidLayoutChange((e) => {
      const info = e as unknown as EditorLayoutInfo;
      callback(info);
    });
    return { dispose: () => d.dispose() };
  }

  onMouseDown(callback: (event: EditorMouseEvent) => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    const d = this.editor.onMouseDown((e) => {
      callback({
        event: {
          x: e.event.posx,
          y: e.event.posy,
          button: e.event.buttons,
          buttons: e.event.buttons,
          ctrlKey: e.event.ctrlKey,
          shiftKey: e.event.shiftKey,
          altKey: e.event.altKey,
          metaKey: e.event.metaKey
        },
        target: {
          type: e.target.type as unknown as import("./types").MouseTargetType,
          position: e.target.position ? { lineNumber: e.target.position.lineNumber, column: e.target.position.column } : null,
          range: e.target.range ? {
            startLineNumber: e.target.range.startLineNumber,
            startColumn: e.target.range.startColumn,
            endLineNumber: e.target.range.endLineNumber,
            endColumn: e.target.range.endColumn
          } : null,
          selection: null
        }
      });
    });
    return { dispose: () => d.dispose() };
  }

  onMouseUp(callback: (event: EditorMouseEvent) => void): Disposable {
    if (!this.editor) return { dispose: () => {} };
    const d = this.editor.onMouseUp((e) => {
      callback({
        event: {
          x: e.event.posx,
          y: e.event.posy,
          button: e.event.buttons,
          buttons: e.event.buttons,
          ctrlKey: e.event.ctrlKey,
          shiftKey: e.event.shiftKey,
          altKey: e.event.altKey,
          metaKey: e.event.metaKey
        },
        target: {
          type: e.target.type as unknown as import("./types").MouseTargetType,
          position: e.target.position ? { lineNumber: e.target.position.lineNumber, column: e.target.position.column } : null,
          range: e.target.range ? {
            startLineNumber: e.target.range.startLineNumber,
            startColumn: e.target.range.startColumn,
            endLineNumber: e.target.range.endLineNumber,
            endColumn: e.target.range.endColumn
          } : null,
          selection: null
        }
      });
    });
    return { dispose: () => d.dispose() };
  }

  layout(width: number, height: number): void {
    this.editor?.layout({ width, height });
  }

  focus(): void {
    this.editor?.focus();
  }

  hasTextFocus(): boolean {
    return this.editor?.hasTextFocus() ?? false;
  }

  hasWidgetFocus(): boolean {
    return this.editor?.hasWidgetFocus() ?? false;
  }

  dispose(): void {
    this.editor = null;
  }
}
