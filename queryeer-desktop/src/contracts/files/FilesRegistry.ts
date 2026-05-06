import type { FileEntity, FileEntityUpdate, FileOpenInput } from "./FileEntity.js";
import type { EditorResolver, MimeHint, MimeResolver } from "./Resolvers.js";
import type { JSX } from "react";

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

export type MimeIconProps = {
  className?: string;
  style?: React.CSSProperties;
};

export type MimeIconContribution = {
  readonly moduleId: string;
  readonly mimeType: string;
  readonly icon: (props: MimeIconProps) => JSX.Element;
};

export type MimeCapabilityRegistry = {
  registerCapabilities: (mimeType: string, capabilities: MimeCapability[]) => void;
  hasCapability: (mimeType: string, capability: MimeCapability) => boolean;
  listMimeTypesByCapability: (capability: MimeCapability) => string[];
  listAllMimeTypes: () => string[];
  registerLabel?: (mimeType: string, label: string) => void;
  getLabel?: (mimeType: string) => string | undefined;
  registerPreferredNewFileMimeType?: (mimeType: string, order?: number) => void;
  listPreferredNewFileMimeTypes?: () => string[];
  registerContentCategory: (mimeType: string, category: ContentCategory) => void;
  getContentCategory: (mimeType: string) => ContentCategory | undefined;
};

export type MimeIconRegistry = {
  registerMimeIcon: (contribution: MimeIconContribution) => void;
  getMimeIcon: (mimeType: string) => ((props: MimeIconProps) => JSX.Element) | undefined;
  listMimeIcons: () => MimeIconContribution[];
};

export type FilesRegistry = {
  capabilities: MimeCapabilityRegistry;
  mimeIcons: MimeIconRegistry;
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
