import type { FileEntity, FileEntityUpdate, FileOpenInput } from "./FileEntity";
import type { EditorResolver, MimeHint, MimeResolver } from "./Resolvers";

export type FilesSubscriber = (files: FileEntity[]) => void;

export type FilesRegistry = {
  openFile: (input: FileOpenInput) => FileEntity;
  closeFile: (fileId: string) => void;
  getFile: (fileId: string) => FileEntity | undefined;
  listFiles: () => FileEntity[];
  updateFile: (fileId: string, update: FileEntityUpdate) => FileEntity | undefined;
  notifyChanged: (fileId: string) => FileEntity | undefined;
  subscribe: (subscriber: FilesSubscriber) => () => void;
  registerMimeResolver: (resolver: MimeResolver) => void;
  registerEditorResolver: (resolver: EditorResolver) => void;
  classifyUri: (uri: string, hint?: MimeHint) => string;
  resolveEditor: (file: FileEntity) => string | undefined;
};
