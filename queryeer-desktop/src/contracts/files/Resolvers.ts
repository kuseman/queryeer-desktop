import type { FileEntity } from "./FileEntity";

export type MimeHint = {
  declared?: string;
  extension?: string;
};

export type MimeResolver = (uri: string, hint?: MimeHint) => string | undefined;

export type EditorResolver = (file: FileEntity) => string | undefined;

export const DEFAULT_MIME_TYPE = "application/octet-stream";
