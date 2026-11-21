import type { CompletionProvider, DiagnosticsProvider, Disposable, HoverProvider, SignatureHelpProvider } from "./EditorApi.js";

/**
 * Monaco Monarch tokenizer definition. Mirrors Monaco's `IMonarchLanguage` without
 * requiring plugins to depend on Monaco's types. Extra keys (keyword lists and other
 * attributes referenced from rules) are allowed.
 */
export type EditorMonarchLanguage = {
  tokenizer: Record<string, unknown[]>;
  ignoreCase?: boolean;
  unicode?: boolean;
  defaultToken?: string;
  tokenPostfix?: string;
  start?: string;
  brackets?: { open: string; close: string; token: string }[];
  [attribute: string]: unknown;
};

/** Subset of Monaco's `LanguageConfiguration`: comments, brackets and auto-closing pairs. */
export type EditorLanguageConfiguration = {
  comments?: {
    lineComment?: string;
    blockComment?: [string, string];
  };
  brackets?: [string, string][];
  autoClosingPairs?: { open: string; close: string; notIn?: string[] }[];
  surroundingPairs?: { open: string; close: string }[];
  wordPattern?: RegExp;
  folding?: {
    offSide?: boolean;
    markers?: { start: RegExp; end: RegExp };
  };
};

export type EditorLanguageDefinition = {
  /** Monaco language id, e.g. `"mongodb"`. Must not collide with a built-in Monaco language. */
  id: string;
  aliases?: string[];
  monarch: EditorMonarchLanguage;
  configuration?: EditorLanguageConfiguration;
};

export type EditorLanguageRegistry = {
  /** Maps a MIME type to a Monaco language id (built-in or registered with `registerLanguage`). */
  registerMimeType: (mimeType: string, languageId: string) => Disposable;
  /**
   * Registers a new Monaco language with a Monarch tokenizer and optional language
   * configuration. The language has no validation. Pair it with
   * `registerMimeType(mime, definition.id)` to use it for a file type.
   * Throws if the id is blank or already registered by a plugin.
   */
  registerLanguage: (definition: EditorLanguageDefinition) => Disposable;
  /**
   * Offers completion items in editors of `languageId`, typically one the plugin registered with `registerLanguage`.
   * The provider's `document.fileId` is the open file, to ask the plugin's backend with `queryEngines.invoke`.
   * An item without a `range` replaces the word before the cursor. Several providers for one language are merged.
   * A provider that throws or rejects offers nothing; the error is logged. Since 0.22.
   */
  registerCompletionProvider: (languageId: string, provider: CompletionProvider) => Disposable;
  /** Shows a hover in editors of `languageId`. As `registerCompletionProvider`. Since 0.22. */
  registerHoverProvider: (languageId: string, provider: HoverProvider) => Disposable;
  /** Shows parameter hints in editors of `languageId`, e.g. inside a call's parentheses. As `registerCompletionProvider`. Since 0.22. */
  registerSignatureHelpProvider: (languageId: string, provider: SignatureHelpProvider) => Disposable;
  /**
   * Underlines problems in editors of `languageId`. Asked when a document opens and after a pause in typing; its
   * result replaces the provider's earlier diagnostics for that document. Disposing removes them. A provider that
   * throws or rejects shows none; the error is logged. Since 0.22.
   */
  registerDiagnosticsProvider: (languageId: string, provider: DiagnosticsProvider) => Disposable;
};
