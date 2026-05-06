import type { FileEntity } from "../../contracts/files/FileEntity";

export type WorkspaceOpenFilesOrder = "tabOrder" | "alphabetical" | "lastUsed";

function fileName(uri: string): string {
  const normalized = uri.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? uri;
}

export function orderWorkspaceFiles(
  files: FileEntity[],
  order: WorkspaceOpenFilesOrder,
  mruRankByFileId: Map<string, number>
): FileEntity[] {
  const next = [...files];
  if (order === "tabOrder") {
    return next;
  }
  if (order === "alphabetical") {
    next.sort((a, b) => {
      const nameDiff = fileName(a.uri).localeCompare(fileName(b.uri));
      if (nameDiff !== 0) {
        return nameDiff;
      }
      return a.uri.localeCompare(b.uri);
    });
    return next;
  }
  next.sort((a, b) => {
    const rankA = mruRankByFileId.get(a.fileId) ?? Number.NEGATIVE_INFINITY;
    const rankB = mruRankByFileId.get(b.fileId) ?? Number.NEGATIVE_INFINITY;
    if (rankA !== rankB) {
      return rankB - rankA;
    }
    return a.uri.localeCompare(b.uri);
  });
  return next;
}
