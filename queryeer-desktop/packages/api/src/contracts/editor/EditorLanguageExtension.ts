import type { Disposable } from "./EditorApi.js";

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
};
