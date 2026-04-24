export type EngineBinding = {
  engineId: string;
  connectionId?: string;
};

export type ViewStateBag = Record<string, unknown>;

export type FileEntityMetadata = Record<string, unknown>;

export type FileDiskState = "inSync" | "modifiedOnDisk" | "deletedOnDisk";

export type FileEntity = {
  fileId: string;
  version: number;
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  dirtyVsBackend: boolean;
  dirtyVsDisk: boolean;
  diskState: FileDiskState;
  backupUri?: string;
  hasRecoveredBackup?: boolean;
  runtimeViewState?: unknown;
  persistentViewState?: ViewStateBag;
  openedAt: string;
  metadata?: FileEntityMetadata;
};

export type FileOpenInput = {
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  persistentViewState?: ViewStateBag;
};

export type FileEntityUpdate = Partial<
  Pick<
    FileEntity,
    | "uri"
    | "mimeType"
    | "version"
    | "editorId"
    | "engineBinding"
    | "dirtyVsBackend"
    | "dirtyVsDisk"
    | "diskState"
    | "backupUri"
    | "hasRecoveredBackup"
    | "runtimeViewState"
    | "persistentViewState"
    | "metadata"
  >
>;
