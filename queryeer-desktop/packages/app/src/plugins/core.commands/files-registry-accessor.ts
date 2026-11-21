import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";

let instance: FilesRegistry | null = null;

export function setFilesRegistry(registry: FilesRegistry): void {
  instance = registry;
}

export function getFilesRegistry(): FilesRegistry | null {
  return instance;
}

/**
 * Monaco's `Uri.toString()` percent-encodes more than core's file URIs do (a Windows drive's colon, and `( ) ' & ! $ ,`
 * and the like in file names) and lower-cases the drive letter; compare URIs decoded and without case.
 */
export function normalizeUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  }
  catch {
    // A lone "%" that isn't an escape: compare as it is
  }
  return decoded.toLowerCase();
}

/** The open file an editor model shows, from the model's URI (`model.uri.toString()`). */
export function findFileForModelUri(uri: string): FileEntity | undefined {
  const filesRegistry = getFilesRegistry();
  if (!filesRegistry) {
    return undefined;
  }
  const normalized = normalizeUri(uri);
  return filesRegistry
    .listFiles()
    .find((file) => normalizeUri(file.uri) === normalized);
}
