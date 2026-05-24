import type { FileEntity } from "./FileEntity.js";

export type MimeHint = {
  declared?: string;
  extension?: string;
};

export type MimeResolver = (uri: string, hint?: MimeHint) => string | undefined;

export type EditorResolver = (file: FileEntity) => string | undefined;

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export function fileUriToPath(uri: string): string {
  const decoded = decodeURIComponent(uri);
  if (!decoded.startsWith("file://")) {
    return decoded;
  }
  const withoutScheme = decoded.startsWith("file:///")
    ? decoded.slice(8)
    : decoded.slice("file://".length);
  const isWindows = /^[A-Za-z]:/.test(withoutScheme);
  if (isWindows) {
    return withoutScheme.replace(/\//g, "\\");
  }
  return withoutScheme;
}

export function pathToFileUri(filePath: string): string {
  return "file:///" + filePath.replace(/\\/g, "/");
}
