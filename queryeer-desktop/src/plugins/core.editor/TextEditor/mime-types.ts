import type {
  FilesRegistry,
  MimeCapability
} from "../../../contracts/files/FilesRegistry";
import {
  createExtensionMimeResolver,
  registerMimeTypeBundle,
  type MimeTypeRegistration
} from "../../core.files/mime-registration";

type TextMimeTypeRegistration = MimeTypeRegistration & {
  monacoLanguageId: string;
};

const TEXT_CAPABILITIES: MimeCapability[] = ["backupable", "editable", "viewable"];

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

for (const registration of TEXT_EDITOR_MIME_TYPES) {
  MIME_TYPE_TO_LANGUAGE.set(registration.mimeType, registration.monacoLanguageId);
}

export function resolveTextEditorMimeType(extension: string | undefined): string | undefined {
  return resolveMimeTypeByExtension(extension);
}

export function resolveMonacoLanguageId(mimeType: string): string {
  return MIME_TYPE_TO_LANGUAGE.get(mimeType) ?? "plaintext";
}

export function registerTextEditorMimeTypes(files: FilesRegistry): void {
  registerMimeTypeBundle(files, TEXT_EDITOR_MIME_TYPES, resolveTextEditorMimeType);
}
