import type { FileEntity } from "../../contracts/files/FileEntity";

export type ShowCloseDialog = (options: {
  title: string;
  message: string;
  severity?: "info" | "warning" | "error";
  detail?: string;
  options?: { label: string; value: string }[];
}) => Promise<{ action: string }>;

export function fileDisplayName(uri: string): string {
  if (uri.startsWith("file://")) {
    return uri.split("/").pop() ?? uri;
  }
  if (uri.startsWith("untitled:")) {
    return uri.slice(9);
  }
  return uri;
}

export async function confirmCloseDirtyFile(
  file: FileEntity,
  showDialog: ShowCloseDialog
): Promise<boolean> {
  const hasUnsavedChanges = file.dirtyVsDisk || file.dirtyVsBackend;
  if (!hasUnsavedChanges) {
    return true;
  }

  const result = await showDialog({
    title: "Unsaved Changes",
    message: `The file "${fileDisplayName(file.uri)}" has unsaved changes. Close without saving?`,
    severity: "warning",
    options: [
      { label: "Cancel", value: "cancel" },
      { label: "Close Without Saving", value: "discard" }
    ]
  });
  return result.action === "discard";
}
