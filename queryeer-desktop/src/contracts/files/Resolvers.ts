import type { FileEntity } from "./FileEntity";

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

  const pathPart = decoded.slice("file://".length);
  const isWindows = typeof navigator !== "undefined" && /Win/.test(navigator.platform ?? "");
  if (isWindows) {
    return pathPart.replace(/\//g, "\\").replace(/^\\/, "");
  }
  return "/" + pathPart;
}
