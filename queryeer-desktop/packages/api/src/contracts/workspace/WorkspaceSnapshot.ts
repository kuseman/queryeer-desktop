import type { LayoutZone } from "../extensions/LayoutExtension.js";
import type { EngineBinding, ViewStateBag } from "../files/FileEntity.js";

export const WORKSPACE_SCHEMA_VERSION = 2;

export type PersistedFileEntry = {
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  backupFileId?: string;
  persistentViewState?: ViewStateBag;
};

export type PersistedEditorGroup = {
  id: string;
  fileUris: string[];
  activeFileUri?: string;
};

export type PersistedEditorLayoutNode =
  | {
      kind: "leaf";
      groupId: string;
    }
  | {
      kind: "split";
      /** horizontal = left-to-right children, vertical = top-to-bottom children. */
      direction: "horizontal" | "vertical";
      children: PersistedEditorLayoutNode[];
      sizes?: number[];
    };

export type PersistedLayoutSnapshot = {
  visibleZones?: LayoutZone[];
  sidebarWidths?: {
    primary?: number;
    secondary?: number;
  };
  sidebarPanelStates?: Record<string, boolean>;
  sidebarPanelHeights?: Record<string, number>;
  panelHeight?: number;
  editorGroups?: PersistedEditorGroup[];
  activeEditorGroupId?: string;
  maximizedEditorGroupId?: string;
  editorLayout?: PersistedEditorLayoutNode;
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
