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

export type TextRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type TextLine = {
  readonly lineNumber: number;
  readonly text: string;
  readonly range: TextRange;
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

export type TextDocument = {
  readonly uri: string;
  readonly languageId: string;
  getText(range?: TextRange): string;
  lineCount: number;
  lineAt(lineNumber: number): TextLine;
};

export type TextEditorEditOperation =
  | { type: "insert"; position: Position; text: string }
  | { type: "delete"; range: TextRange }
  | { type: "replace"; range: TextRange; text: string };

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

export type RevealType = "default" | "top" | "center" | "centerIfOutsideViewport";

export type WordAtPosition = {
  word: string;
  startColumn: number;
  endColumn: number;
};

export type Disposable = {
  dispose(): void;
};

export type CursorStyle = "line" | "block" | "underline" | "line-thin" | "block-outline" | "underline-thin";
export type CursorBlinking = "blink" | "smooth" | "phase" | "expand" | "solid";
export type RenderLineHighlight = "all" | "line" | "none" | "gutter";
export type MiniMap = "enabled" | "disabled" | "proportional" | "showAtLine";

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
  parameterHints?: boolean;
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