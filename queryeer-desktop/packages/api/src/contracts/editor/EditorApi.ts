export type CursorStyle =
  | "line"
  | "block"
  | "underline"
  | "line-thin"
  | "block-outline"
  | "underline-thin";

export type CursorBlinking = "blink" | "smooth" | "phase" | "expand" | "solid";

export type RenderLineHighlight = "all" | "line" | "none" | "gutter";

export type MiniMap = "enabled" | "disabled" | "proportional" | "showAtLine";

export type RevealType = "default" | "top" | "center" | "centerIfOutsideViewport";

export type TextDocument = {
  readonly uri: string;
  readonly languageId: string;
  getText(range?: TextRange): string;
  lineCount: number;
  lineAt(lineNumber: number): TextLine;
};

export type TextLine = {
  readonly lineNumber: number;
  readonly text: string;
  readonly range: TextRange;
};

export type TextRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type Position = {
  readonly lineNumber: number;
  readonly column: number;
};

export type Selection = {
  readonly selectionStartLineNumber: number;
  readonly selectionStartColumn: number;
  readonly positionLineNumber: number;
  readonly positionColumn: number;
};

export type TextEditorEditOperation =
  | { type: "insert"; position: Position; text: string }
  | { type: "delete"; range: TextRange }
  | { type: "replace"; range: TextRange; text: string };

export type CompletionItem = {
  label: string;
  kind: CompletionItemKind;
  detail?: string;
  documentation?: string;
  insertText: string;
  range?: TextRange;
  sortText?: string;
  filterText?: string;
  preselect?: boolean;
};

export enum CompletionItemKind {
  Method = 0,
  Function = 1,
  Constructor = 2,
  Field = 3,
  Variable = 4,
  Class = 5,
  Interface = 6,
  Module = 7,
  Property = 8,
  Unit = 9,
  Value = 10,
  Enum = 11,
  Keyword = 12,
  Snippet = 13,
  Text = 14,
  Color = 15,
  File = 16,
  Reference = 17,
  Folder = 18,
  EnumMember = 19,
  Constant = 20,
  Struct = 21,
  Event = 22,
  Operator = 23,
  TypeParameter = 24
}

export type CompletionContext = {
  readonly triggerKind: CompletionTriggerKind;
  readonly triggerCharacter?: string;
};

export enum CompletionTriggerKind {
  Invoked = 0,
  TriggerCharacter = 1,
  TriggerForIncompleteCompletions = 2
}

export type CompletionProvider = {
  triggerCharacters?: string[];
  provideCompletionItems(
    document: TextDocument,
    position: Position,
    context: CompletionContext,
    token: CancellationToken
  ): ProviderResult<CompletionList>;
};

export type CompletionList = {
  suggestions: CompletionItem[];
  incomplete?: boolean;
};

export type CancellationToken = {
  readonly isCancellationRequested: boolean;
};

export type ProviderResult<T> = T | Promise<T> | null | undefined;

export type CodeLens = {
  range: TextRange;
  command?: Command;
};

export type Command = {
  id: string;
  title: string;
  arguments?: unknown[];
};

export type Hover = {
  range: TextRange;
  contents: MarkdownString[];
};

export type MarkdownString = {
  value: string;
  isTrusted?: boolean;
};

export type HoverProvider = {
  provideHover(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<Hover>;
};

export type SignatureHelp = {
  signatures: SignatureInformation[];
  activeSignature: number;
  activeParameter: number;
};

export type SignatureInformation = {
  label: string;
  documentation?: string;
  parameters?: ParameterInformation[];
};

export type ParameterInformation = {
  label: string;
  documentation?: string;
};

export type SignatureHelpProvider = {
  signatureHelpTriggerCharacters?: string[];
  signatureHelpRetriggerCharacters?: string[];
  provideSignatureHelp(
    document: TextDocument,
    position: Position,
    token: CancellationToken
  ): ProviderResult<SignatureHelp>;
};

export type FormatOptions = {
  insertSpaces: boolean;
  tabSize: number;
  trimTrailingWhitespace?: boolean;
};

export type DocumentFormattingEditProvider = {
  provideDocumentFormattingEdits(
    document: TextDocument,
    options: FormatOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>;
};

export type DocumentRangeFormattingEditProvider = {
  provideDocumentRangeFormattingEdits(
    document: TextDocument,
    range: TextRange,
    options: FormatOptions,
    token: CancellationToken
  ): ProviderResult<TextEdit[]>;
};

export type TextEdit = {
  range: TextRange;
  newText: string;
};

export type WordAtPosition = {
  word: string;
  startColumn: number;
  endColumn: number;
};

export type GoToLocationOptions = {
  multiple?: GoToLocationMultiple;
};

export type GoToLocationMultiple = "peek" | "gotoAndPeek" | "goto";

export type EditorOptions = {
  cursorStyle?: CursorStyle;
  cursorBlinking?: CursorBlinking;
  lineNumbers?: "on" | "off" | "relative";
  renderLineHighlight?: RenderLineHighlight;
  minimap?: MiniMap;
  wordWrap?: "on" | "off" | "wordWrapColumn" | "bounded";
  tabSize?: number;
  insertSpaces?: boolean;
  fontSize?: number;
  fontFamily?: string;
  lineHeight?: number;
  padding?: { top: number; bottom: number };
  scrollBeyondLastLine?: boolean;
  automaticLayout?: boolean;
  folding?: boolean;
  foldingHighlight?: boolean;
  showFoldingControls?: "always" | "mouseover" | "never";
  matchBrackets?: "always" | "never" | "boundary";
  links?: boolean;
  contextmenu?: boolean;
  quickSuggestions?: boolean | { other: boolean; comments: boolean; strings: boolean };
  suggestOnTriggerCharacters?: boolean;
  acceptSuggestionOnEnter?: "on" | "smart" | "off";
  snippetSuggestions?: "top" | "bottom" | "inline" | "none";
  wordBasedSuggestions?: "currentDocument" | "matchingDocuments" | "allDocuments" | "off";
  selectionHighlight?: boolean;
  occurrencesHighlight?: boolean;
  codeLens?: boolean;
  formatOnPaste?: boolean;
  formatOnType?: boolean;
  autoIndent?: boolean | "full" | "brackets" | "keep";
  readOnly?: boolean;
  domReadOnly?: boolean;
  renderWhitespace?: "none" | "boundary" | "all" | "selection";
  renderControlCharacters?: boolean;
  glyphMargin?: boolean;
  fixedOverflowWidgets?: boolean;
  overviewRulerBorder?: boolean;
  overviewRulerLanes?: number;
  hideCursorInOverviewRuler?: boolean;
  scrollbar?: ScrollbarOptions;
  suggest?: SuggestOptions;
  parameterHints?: ParameterHintsOptions;
};

export type ScrollbarOptions = {
  vertical?: string;
  horizontal?: string;
  verticalScrollbarSize?: number;
  horizontalScrollbarSize?: number;
  useShadows?: boolean;
  verticalHasArrows?: boolean;
  horizontalHasArrows?: boolean;
  handleMouseWheel?: boolean;
  mouseWheelScrollSensitivity?: number;
  fastScrollSensitivity?: number;
};

export type SuggestOptions = {
  showIcons?: boolean;
  showStatusBar?: boolean;
  showMethods?: boolean;
  showFunctions?: boolean;
  showConstructors?: boolean;
  showFields?: boolean;
  showVariables?: boolean;
  showClasses?: boolean;
  showStructs?: boolean;
  showInterfaces?: boolean;
  showModules?: boolean;
  showProperties?: boolean;
  showEvents?: boolean;
  showOperators?: boolean;
  showUnits?: boolean;
  showValues?: boolean;
  showConstants?: boolean;
  showEnums?: boolean;
  showEnumMembers?: boolean;
  showKeywords?: boolean;
  showWords?: boolean;
  showColors?: boolean;
  showFiles?: boolean;
  showReferences?: boolean;
  showFolders?: boolean;
  showTypeParameters?: boolean;
  showSnippets?: boolean;
};

export type ParameterHintsOptions = {
  enabled?: boolean;
  cycle?: boolean;
};

export interface ICodeEditor {
  readonly editorId: string;

  getModel(): TextDocument | null;
  setModel(model: TextDocument | null): void;

  getPosition(): Position | null;
  setPosition(position: Position, revealType?: RevealType): void;

  getSelection(): Selection | null;
  setSelection(selection: Selection): void;
  revealLine(lineNumber: number, revealType?: RevealType): void;
  revealLineInCenter(lineNumber: number): void;
  revealPositionInCenter(position: Position): void;
  revealRange(range: TextRange, revealType?: RevealType): void;

  getWordAtPosition(position: Position): WordAtPosition | null;
  getWordUntilPosition(position: Position, maxLength?: number): WordAtPosition | null;

  getContent(): string;
  getLineContent(lineNumber: number): string;
  getLineCount(): number;
  getOffsetForPosition(lineNumber: number, column: number): number;
  getPositionAt(offset: number): Position;

  executeEdits(operations: TextEditorEditOperation[]): boolean;
  applyEdits(edits: TextEdit[]): boolean;

  insertSnippet(text: string, range?: TextRange): boolean;
  insertSnippetAtCursor(text: string): boolean;

  toggleCommentLine(): void;
  addCommentLine(): void;
  removeCommentLine(): void;

  transformToUppercase(): void;
  transformToLowercase(): void;
  transformToTitleCase(): void;
  transformToSnakeCase(): void;
  transformToCamelCase(): void;
  transformToPascalCase(): void;
  transformToKebabCase(): void;

  blockComment(): void;
  duplicateSelection(): void;
  removeDuplicateLines(): void;
  reverseLines(): void;
  insertLineBefore(): void;
  insertLineAfter(): void;

  insertCursorAbove(): void;
  insertCursorBelow(): void;
  insertCursorAtEndOfLines(): void;
  selectAllOccurrences(): void;
  addSelectionToNextFindMatch(): void;

  format(): Promise<void>;
  formatRange(range: TextRange): Promise<void>;
  formatOnPaste(): Promise<void>;

  goToDefinition(): Promise<void>;
  peekDefinition(): Promise<void>;
  goToTypeDefinition(): Promise<void>;
  goToImplementation(): Promise<void>;
  peekImplementation(): Promise<void>;
  findReferences(): Promise<void>;

  find(searchString: string): void;
  findNext(searchString: string): void;
  findPrevious(searchString: string): void;
  findWithOptions(options: FindOptions): void;
  closeFindWidget(): void;

  addAction(descriptor: EditorActionDescriptor): void;

  updateOptions(options: EditorOptions): void;
  updateOptionsForLanguage(languageId: string, options: EditorOptions): void;

  pushUndoStop(): boolean;
  popUndoStop(): boolean;

  getVisibleColumnFromMouseEvent(e: unknown): number;

  onDidChangeModelContent(callback: (event: ModelContentChangedEvent) => void): Disposable;
  onDidChangeCursorPosition(
    callback: (event: CursorPositionChangedEvent) => void
  ): Disposable;
  onDidChangeCursorSelection(
    callback: (event: CursorSelectionChangedEvent) => void
  ): Disposable;
  onDidFocusEditorText(callback: () => void): Disposable;
  onDidBlurEditorText(callback: () => void): Disposable;
  onDidFocusEditorWidget(callback: () => void): Disposable;
  onDidBlurEditorWidget(callback: () => void): Disposable;
  onWillFireBeforeKeydown(
    callback: (event: KeyDownEvent) => boolean | void
  ): Disposable;
  onDidFireAfterKeydown(callback: (event: KeyDownEvent) => void): Disposable;
  onBeforeRender(callback: () => void): Disposable;
  onDidLayoutChange(callback: (layoutInfo: EditorLayoutInfo) => void): Disposable;
  onMouseDown(callback: (event: EditorMouseEvent) => void): Disposable;
  onMouseUp(callback: (event: EditorMouseEvent) => void): Disposable;

  layout(width: number, height: number): void;
  focus(): void;
  hasTextFocus(): boolean;
  hasWidgetFocus(): boolean;
  dispose(): void;
}

export type Disposable = {
  dispose(): void;
};

export type ModelContentChangedEvent = {
  readonly changes: ContentChange[];
  readonly eol: string;
  readonly isFlush: boolean;
  readonly isRedo: boolean;
  readonly isUndo: boolean;
  readonly versionId: number;
};

export type ContentChange = {
  readonly range: TextRange;
  readonly rangeLength: number;
  readonly text: string;
};

export type CursorPositionChangedEvent = {
  readonly position: Position;
  readonly reason: CursorChangeReason;
};

export enum CursorChangeReason {
  ContentFlush = 0,
  RecoverFromScroll = 1,
  explicit = 2,
  Paste = 3,
  Undo = 4,
  Redo = 5,
  OutgoingUndo = 6,
  Shoft = 7,
  NotSet = 8
}

export type CursorSelectionChangedEvent = {
  readonly selection: Selection;
  readonly source: string;
  readonly reason: CursorChangeReason;
};

export type KeyDownEvent = {
  readonly code: string;
  readonly key: string;
  readonly keyCode: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
};

export type EditorLayoutInfo = {
  readonly width: number;
  readonly height: number;
  readonly contentLeft: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly lineHeight: number;
  readonly glyphMarginLeft: number;
  readonly glyphMarginWidth: number;
  readonly lineNumbersLeft: number;
  readonly lineNumbersWidth: number;
  readonly minimapLeft: number;
  readonly minimapWidth: number;
  readonly minimapHeight: number;
  readonly overflowGuardLeft: number;
  readonly overflowGuardWidth: number;
};

export type EditorMouseEvent = {
  readonly event: MouseEvent;
  readonly target: EditorMouseTarget;
};

export type MouseEvent = {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
};

export type EditorMouseTarget = {
  readonly type: MouseTargetType;
  readonly position: Position | null;
  readonly range: TextRange | null;
  readonly selection: Selection | null;
};

export enum MouseTargetType {
  UNKNOWN = 0,
  TEXTAREA = 1,
  GUTTER_GLYPH_MARGIN = 2,
  GUTTER_LINE_NUMBERS = 3,
  GUTTER_WHITESPACE = 4,
  CONTENT_TEXT = 5,
  CONTENT_EMPTY = 6,
  CONTENT_WIDGET = 7,
  OVERVIEW_GUTTER = 8,
  OVERLAY_WIDGET = 9,
  SCROLLBAR = 10,
  TEXTAREA_HANDLE = 11,
  OVERLAY_MASK = 12,
  OVERLAY = 13,
  BASE_CURSOR = 14,
  CARET = 15
}

export type FindOptions = {
  searchString?: string;
  replaceString?: string;
  isRegex?: boolean;
  isCaseSensitive?: boolean;
  matchWholeWord?: boolean;
  isSearchInSelection?: boolean;
  findPrevious?: boolean;
  captureMatches?: boolean;
};

export type EditorActionDescriptor = {
  id: string;
  label: string;
  keybindingContextKey?: string;
  keybindings: Keybinding[];
  run(): void;
};

export type Keybinding = {
  primary: number;
  chord?: { keyCode: number; modifiers: number };
  label?: string;
};

export type ICodeEditorFactory = {
  create(container: HTMLElement, options?: EditorOptions): ICodeEditor;
  createWithModel(
    container: HTMLElement,
    model: TextDocument,
    options?: EditorOptions
  ): ICodeEditor;
  setLanguageForModel(model: TextDocument, languageId: string): void;
  setModelContent(model: TextDocument, content: string): void;
  getOrCreateModel(uri: string): TextDocument | null;
  destroyModel(uri: string): void;
};

export type EditorContextMenuEvent = {
  event: {
    x: number;
    y: number;
  };
  target: {
    position: Position | null;
    range: TextRange | null;
  };
};