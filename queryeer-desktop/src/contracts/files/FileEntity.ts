export type EngineBinding = {
  engineId: string;
  connectionId?: string;
};

export type FileEntity = {
  fileId: string;
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  dirtyVsBackend: boolean;
  dirtyVsDisk: boolean;
  version: number;
  backendVersion?: number;
  diskVersion?: number;
  openedAt: string;
};

export type FileOpenInput = {
  uri: string;
  mimeType: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  diskVersion?: number;
};

export type FileEntityUpdate = Partial<
  Pick<
    FileEntity,
    | "mimeType"
    | "editorId"
    | "engineBinding"
    | "backendVersion"
    | "diskVersion"
    | "dirtyVsBackend"
    | "dirtyVsDisk"
  >
>;
