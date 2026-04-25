import type { EngineBinding, FileEntity, ViewStateBag } from "./FileEntity.js";
import type { MimeHint } from "./Resolvers.js";
import type { FileOpenIntent } from "./FilesRegistry.js";

export type FileOpenHint = {
  mimeType?: string;
  editorId?: string;
  engineBinding?: EngineBinding;
  openIntent?: FileOpenIntent;
  persistentViewState?: ViewStateBag;
} & Pick<MimeHint, "extension">;

export type FileCloseOptions = {
  discardDirty?: boolean;
};

export type FileExecuteResult = {
  queryExecutionId: string;
  accepted: boolean;
};

export type FileMediator = {
  openFile: (uri: string, hint?: FileOpenHint) => Promise<FileEntity>;
  closeFile: (fileId: string, opts?: FileCloseOptions) => Promise<void>;
  saveFile: (fileId: string) => Promise<void>;
  setActiveFileId: (fileId: string | null) => void;
  getActiveFileId: () => string | null;
  bindEngine: (
    fileId: string,
    engineId: string,
    connectionId?: string
  ) => Promise<FileEntity | undefined>;
  executeFile: (fileId: string, text: string) => Promise<FileExecuteResult>;
  reloadFile: (fileId: string) => Promise<FileEntity | undefined>;
  acceptExternalChange: (fileId: string) => Promise<FileEntity | undefined>;
  discardExternalChange: (fileId: string) => Promise<FileEntity | undefined>;
};
