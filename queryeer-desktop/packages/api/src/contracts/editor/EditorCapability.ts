import type { OutlineSymbol } from "../extensions/OutlineExtension.js";
import type { Disposable, TextRange } from "./EditorApi.js";

export type OutlineCapability = {
  getSymbols(): OutlineSymbol[] | Promise<OutlineSymbol[]>;
  revealSymbol(symbol: OutlineSymbol): void;
  onSymbolsChanged(callback: () => void): Disposable;
};

export type FormatCapability = {
  format(): Promise<void>;
};

export type ContentCapability = {
  getContent(): string;
  setContent(content: string): void;
};

export type FocusCapability = {
  focus(): void;
};

export type SelectionCapability = {
  getSelectedText(): string | null;
  getContent(): string;
  getContentFromRange?(range: TextRange): string | undefined;
  getSelection(): {
    selectionStartLineNumber: number;
    selectionStartColumn: number;
    positionLineNumber: number;
    positionColumn: number;
  } | null;
};

export type VersionedTextEditResult =
  | { ok: true; version: number }
  | { ok: false; reason: "versionMismatch"; expectedVersion: number; actualVersion: number }
  | { ok: false; reason: "invalidRange"; message: string; actualVersion: number }
  | { ok: false; reason: "editFailed"; actualVersion: number };

export type VersionedTextEditCapability = {
  getVersionId(): number;
  replaceRange(expectedVersion: number, range: TextRange, text: string): VersionedTextEditResult;
  onDidChangeVersion(callback: (version: number) => void): Disposable;
};

export type EditorHandle = {
  readonly editorId: string;
  readonly fileId: string | null;
  outline?: OutlineCapability;
  format?: FormatCapability;
  content?: ContentCapability;
  focus?: FocusCapability;
  selection?: SelectionCapability;
  versionedTextEdit?: VersionedTextEditCapability;
};

export type EditorRegistry = {
  getActiveEditor(): EditorHandle | null;
  onActiveEditorChanged(callback: (editor: EditorHandle | null) => void): Disposable;
};

export type EditorContentRepository = {
  getModelForFile(fileId: string): { getContent(): string } | undefined;
  getModelForUri(uri: string): { getContent(): string } | undefined;
  updateModelContent(uri: string, content: string): void;
  applyRecoveredContent(fileId: string, content: string): void;
  onContentDirty(listener: (fileId: string, text: string) => void): () => void;
};

export type EditorRegistryHost = EditorRegistry & {
  setActiveEditor(handle: EditorHandle | null): void;
  registerContentRepository(repo: EditorContentRepository): () => void;
  resolveFileContent(fileId: string, uri: string): string | undefined;
  broadcastContentUpdate(uri: string, content: string): void;
  applyRecoveredContent(fileId: string, content: string): void;
  onContentDirty(listener: (fileId: string, text: string) => void): () => void;
};
