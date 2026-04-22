import type { FileEntity, FileEntityUpdate, FileOpenInput } from "./FileEntity";
import type { EditorResolver, MimeHint, MimeResolver } from "./Resolvers";

export type FilesSubscriber = (files: FileEntity[]) => void;

export type MimeCapability = "backupable" | "executable" | "viewable" | "editable";

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
  notifyChanged: (fileId: string) => FileEntity | undefined;
  subscribe: (subscriber: FilesSubscriber) => () => void;
  registerMimeResolver: (resolver: MimeResolver) => void;
  registerEditorResolver: (resolver: EditorResolver) => void;
  classifyUri: (uri: string, hint?: MimeHint) => string;
  resolveEditor: (file: FileEntity, context?: Partial<EditorResolutionContext>) => string | undefined;
};
