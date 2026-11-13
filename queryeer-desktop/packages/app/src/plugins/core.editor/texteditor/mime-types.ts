import type {
  FilesRegistry,
  MimeCapability
} from "@queryeer/api/files/FilesRegistry";
import {
  createExtensionMimeResolver,
  registerMimeTypeBundle,
  type MimeTypeRegistration
} from "../../core.files/mime-registration";
import type { Disposable } from "@queryeer/api/editor/EditorApi";

type TextMimeTypeRegistration = MimeTypeRegistration & {
  monacoLanguageId: string;
};

const TEXT_CAPABILITIES: MimeCapability[] = ["backupable", "editable", "viewable", "creatable"];

const TEXT_EDITOR_MIME_TYPES: TextMimeTypeRegistration[] = [
  {
    mimeType: "text/plain",
    extensions: ["txt", "log"],
    monacoLanguageId: "plaintext",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "text/markdown",
    extensions: ["md"],
    monacoLanguageId: "markdown",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "application/json",
    extensions: ["json"],
    monacoLanguageId: "json",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "application/yaml",
    extensions: ["yaml", "yml"],
    monacoLanguageId: "yaml",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "application/xml",
    extensions: ["xml"],
    monacoLanguageId: "xml",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "text/csv",
    extensions: ["csv"],
    monacoLanguageId: "plaintext",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "application/sql",
    extensions: ["sql"],
    monacoLanguageId: "sql",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "application/plbsql",
    extensions: ["plbsql"],
    monacoLanguageId: "sql",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "text/html",
    extensions: ["html", "htm"],
    monacoLanguageId: "html",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "text/css",
    extensions: ["css"],
    monacoLanguageId: "css",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "text/javascript",
    extensions: ["js", "mjs", "cjs"],
    monacoLanguageId: "javascript",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  },
  {
    mimeType: "text/typescript",
    extensions: ["ts", "tsx"],
    monacoLanguageId: "typescript",
    contentCategory: "text",
    capabilities: TEXT_CAPABILITIES
  }
];

const resolveMimeTypeByExtension = createExtensionMimeResolver(TEXT_EDITOR_MIME_TYPES);
const MIME_TYPE_TO_LANGUAGE = new Map<string, string>();
const MIME_TYPE_LANGUAGE_OVERRIDES = new Map<string, { token: symbol; languageId: string }[]>();

for (const registration of TEXT_EDITOR_MIME_TYPES) {
  MIME_TYPE_TO_LANGUAGE.set(registration.mimeType, registration.monacoLanguageId);
}

export function resolveTextEditorMimeType(extension: string | undefined): string | undefined {
  return resolveMimeTypeByExtension(extension);
}

export function listTextEditorMimeTypeRegistrations(): readonly TextMimeTypeRegistration[] {
  return TEXT_EDITOR_MIME_TYPES;
}

export function resolveMonacoLanguageId(mimeType: string): string {
  const overrides = MIME_TYPE_LANGUAGE_OVERRIDES.get(mimeType);
  return overrides?.at(-1)?.languageId ?? MIME_TYPE_TO_LANGUAGE.get(mimeType) ?? "plaintext";
}

export function registerMonacoLanguageIdForMimeType(mimeType: string, monacoLanguageId: string): Disposable {
  const normalizedMimeType = mimeType.trim();
  const normalizedLanguageId = monacoLanguageId.trim();
  if (!normalizedMimeType || !normalizedLanguageId) {
    throw new Error("MIME type and language id must be non-empty");
  }

  const token = Symbol(normalizedMimeType);
  const overrides = MIME_TYPE_LANGUAGE_OVERRIDES.get(normalizedMimeType) ?? [];
  overrides.push({ token, languageId: normalizedLanguageId });
  MIME_TYPE_LANGUAGE_OVERRIDES.set(normalizedMimeType, overrides);

  return {
    dispose: () => {
      const current = MIME_TYPE_LANGUAGE_OVERRIDES.get(normalizedMimeType);
      if (!current) {
        return;
      }
      const index = current.findIndex((entry) => entry.token === token);
      if (index >= 0) {
        current.splice(index, 1);
      }
      if (current.length === 0) {
        MIME_TYPE_LANGUAGE_OVERRIDES.delete(normalizedMimeType);
      }
    }
  };
}

export function registerTextEditorMimeTypes(files: FilesRegistry): void {
  registerMimeTypeBundle(files, TEXT_EDITOR_MIME_TYPES, resolveTextEditorMimeType);
}
