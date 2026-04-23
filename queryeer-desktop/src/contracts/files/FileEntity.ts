export type EngineBinding = {
  engineId: string;
  connectionId?: string;
};

export type ViewStateBag = Record<string, unknown>;

export type FileEntityMetadata = Record<string, unknown>;

export type FileEntity = {
  fileId: string;
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  dirtyVsBackend: boolean;
  dirtyVsDisk: boolean;
  externallyModified?: boolean;
  reloadPending?: boolean;
  backupUri?: string;
  hasRecoveredBackup?: boolean;
  runtimeViewState?: unknown;
  persistentViewState?: ViewStateBag;
  version: number;
  backendVersion?: number;
  diskVersion?: number;
  openedAt: string;
  metadata?: FileEntityMetadata;
};

export type FileOpenInput = {
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  diskVersion?: number;
  persistentViewState?: ViewStateBag;
};

export type FileEntityUpdate = Partial<
  Pick<
    FileEntity,
    | "uri"
    | "mimeType"
    | "editorId"
    | "engineBinding"
    | "backendVersion"
    | "diskVersion"
    | "dirtyVsBackend"
    | "dirtyVsDisk"
    | "externallyModified"
    | "reloadPending"
    | "backupUri"
    | "hasRecoveredBackup"
    | "runtimeViewState"
    | "persistentViewState"
    | "metadata"
  >
>;
