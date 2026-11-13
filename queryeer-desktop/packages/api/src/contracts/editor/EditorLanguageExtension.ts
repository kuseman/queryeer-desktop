import type { Disposable } from "./EditorApi.js";

export type EditorLanguageRegistry = {
  registerMimeType: (mimeType: string, languageId: string) => Disposable;
};
