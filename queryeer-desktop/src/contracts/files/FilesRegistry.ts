import type { FileEntity, FileEntityUpdate, FileOpenInput } from "./FileEntity.js";
import type { EditorResolver, MimeHint, MimeResolver } from "./Resolvers.js";

export type FilesSubscriber = (files: FileEntity[]) => void;

export type MimeCapability = "backupable" | "queryexecutable" | "viewable" | "editable";

export type ContentCategory = "text" | "image" | "binary";

export type FileOpenIntent = "edit" | "view";

export type EditorResolutionContext = {
  uri: string;
  mimeType: string;
  openIntent: FileOpenIntent;
  contentCategory?: ContentCategory;
};

export type MimeCapabilityRegistry = {
  registerCapabilities: (mimeType: string, capabilities: MimeCapability[]) => void;
  hasCapability: (mimeType: string, capability: MimeCapability) => boolean;
  registerContentCategory: (mimeType: string, category: ContentCategory) => void;
  getContentCategory: (mimeType: string) => ContentCategory | undefined;
};

export type FilesRegistry = {
  capabilities: MimeCapabilityRegistry;
  openFile: (input: FileOpenInput) => FileEntity;
  closeFile: (fileId: string) => void;
  getFile: (fileId: string) => FileEntity | undefined;
  listFiles: () => FileEntity[];
  updateFile: (fileId: string, update: FileEntityUpdate) => FileEntity | undefined;
  subscribe: (subscriber: FilesSubscriber) => () => void;
  registerMimeResolver: (resolver: MimeResolver) => void;
  registerEditorResolver: (resolver: EditorResolver) => void;
  classifyUri: (uri: string, hint?: MimeHint) => string;
  resolveEditor: (file: FileEntity, context?: Partial<EditorResolutionContext>) => string | undefined;
  getEditorState: (fileId: string, editorKey: string) => unknown;
  setEditorState: (fileId: string, editorKey: string, state: unknown) => void;
  markDirty: (fileId: string) => void;
};
