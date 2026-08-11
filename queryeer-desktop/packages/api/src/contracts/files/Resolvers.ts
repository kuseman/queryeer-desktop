import type { FileEntity } from "./FileEntity.js";

export type MimeHint = {
  declared?: string;
  extension?: string;
};

export type MimeResolver = (uri: string, hint?: MimeHint) => string | undefined;

export type EditorResolver = (file: FileEntity) => string | undefined;

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export function fileUriToPath(uri: string): string {
  if (!uri.startsWith("file:")) {
    return decodeURIComponent(uri);
  }

  const fileUrl = new URL(uri);
  const pathname = decodeURIComponent(fileUrl.pathname);
  if (fileUrl.hostname) {
    return `\\\\${decodeURIComponent(fileUrl.hostname)}${pathname.replace(/\//g, "\\")}`;
  }
  if (/^\/[A-Za-z]:/.test(pathname)) {
    return pathname.slice(1).replace(/\//g, "\\");
  }
  return pathname;
}

export function pathToFileUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("//")) {
    const withoutPrefix = normalized.slice(2);
    const separatorIndex = withoutPrefix.indexOf("/");
    const hostname = separatorIndex >= 0 ? withoutPrefix.slice(0, separatorIndex) : withoutPrefix;
    const pathname = separatorIndex >= 0 ? withoutPrefix.slice(separatorIndex) : "/";
    const fileUrl = new URL(`file://${hostname}/`);
    fileUrl.pathname = pathname.replace(/%/g, "%25");
    return fileUrl.href;
  }

  const pathname = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const fileUrl = new URL("file:///");
  fileUrl.pathname = pathname.replace(/%/g, "%25");
  return fileUrl.href;
}
