import type { LayoutZone } from "../extensions/LayoutExtension";
import type { EngineBinding } from "../files/FileEntity";

export const WORKSPACE_SCHEMA_VERSION = 1;

export type PersistedFileEntry = {
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  backupFileId?: string;
};

export type PersistedLayoutSnapshot = {
  visibleZones?: LayoutZone[];
  sidebarWidths?: {
    primary?: number;
    secondary?: number;
  };
};

export type WorkspaceSnapshot = {
  schemaVersion: typeof WORKSPACE_SCHEMA_VERSION;
  savedAt: string;
  activeFileUri?: string;
  files: PersistedFileEntry[];
  layout?: PersistedLayoutSnapshot;
};

export function emptyWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    savedAt: new Date(0).toISOString(),
    files: []
  };
}
