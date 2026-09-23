import type { FileEntity } from "@queryeer/api/files/FileEntity";

/**
 * Compares two FileEntity arrays for layout-relevant equality.
 * Ignores per-edit version changes so React can bail out while typing.
 */
export function filesAreStructurallyIdentical(
  prev: readonly FileEntity[],
  next: readonly FileEntity[]
): boolean {
  if (prev === next) return true;
  if (prev.length !== next.length) return false;
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (a.fileId !== b.fileId || a.uri !== b.uri || a.mimeType !== b.mimeType ||
        a.editorId !== b.editorId || a.engineBinding !== b.engineBinding ||
        a.dirtyVsBackend !== b.dirtyVsBackend || a.dirtyVsDisk !== b.dirtyVsDisk ||
        a.diskState !== b.diskState ||
        a.backupUri !== b.backupUri || a.hasRecoveredBackup !== b.hasRecoveredBackup ||
        a.runtimeViewState !== b.runtimeViewState ||
        a.persistentViewState !== b.persistentViewState ||
        a.openedAt !== b.openedAt || a.metadata !== b.metadata) {
      return false;
    }
  }
  return true;
}
