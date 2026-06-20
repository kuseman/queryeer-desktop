import type { FileEntity } from "@queryeer/api/files/FileEntity";
import {
  closeFileInGroup,
  isFileReferenced,
  type EditorWorkbenchState
} from "./editor-workbench-state";
import { hasUnsavedChanges } from "./close-file-guard";

export type CloseFilePlan = {
  nextWorkbench: EditorWorkbenchState;
  shouldConfirm: boolean;
  shouldCloseGlobally: boolean;
};

export function planCloseFileInGroup(
  state: EditorWorkbenchState,
  groupId: string,
  fileId: string,
  file: FileEntity | undefined
): CloseFilePlan {
  const nextWorkbench = closeFileInGroup(state, groupId, fileId);
  return {
    nextWorkbench,
    shouldConfirm: file ? hasUnsavedChanges(file) : false,
    shouldCloseGlobally: !isFileReferenced(nextWorkbench, fileId)
  };
}
