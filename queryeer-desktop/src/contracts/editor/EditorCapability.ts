import type { OutlineSymbol } from "../extensions/OutlineExtension.js";
import type { Disposable } from "./EditorApi.js";

export type OutlineCapability = {
  getSymbols(): OutlineSymbol[] | Promise<OutlineSymbol[]>;
  revealSymbol(symbol: OutlineSymbol): void;
  onSymbolsChanged(callback: () => void): Disposable;
};

export type EditorHandle = {
  readonly editorId: string;
  outline?: OutlineCapability;
};

export type EditorRegistry = {
  getActiveEditor(): EditorHandle | null;
  onActiveEditorChanged(callback: (editor: EditorHandle | null) => void): Disposable;
};

export type EditorRegistryHost = EditorRegistry & {
  setActiveEditor(handle: EditorHandle | null): void;
};