import type { EngineBinding, FileEntity } from "./FileEntity";
import type { MimeHint } from "./Resolvers";

export type FileOpenHint = {
  mimeType?: string;
  editorId?: string;
  engineBinding?: EngineBinding;
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
  notifyChanged: (fileId: string, text: string) => void;
  bindEngine: (
    fileId: string,
    engineId: string,
    connectionId?: string
  ) => Promise<FileEntity | undefined>;
  executeFile: (fileId: string, text: string) => Promise<FileExecuteResult>;
};
