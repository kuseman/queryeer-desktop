import type {
  FileEntity,
  FileEntityUpdate,
  FileOpenInput
} from "../../contracts/files/FileEntity";
import type {
  ContentCategory,
  FilesRegistry,
  FilesSubscriber,
  MimeCapability,
  MimeCapabilityRegistry
} from "../../contracts/files/FilesRegistry";
import {
  DEFAULT_MIME_TYPE,
  type EditorResolver,
  type MimeHint,
  type MimeResolver
} from "../../contracts/files/Resolvers";
import type { LayoutEditorContribution } from "../../contracts/extensions/LayoutExtension";

let fileIdCounter = 0;

function generateFileId(): string {
  fileIdCounter += 1;
  return `f-${Date.now().toString(36)}-${fileIdCounter}`;
}

export type FileRegistryOptions = {
  getEditors?: () => LayoutEditorContribution[];
};

export class FileRegistry {
  private readonly files = new Map<string, FileEntity>();
  private readonly subscribers = new Set<FilesSubscriber>();
  private readonly mimeResolvers: MimeResolver[] = [];
  private readonly editorResolvers: EditorResolver[] = [];
  private readonly mimeCapabilities = new Map<string, Set<MimeCapability>>();
  private readonly mimeContentCategories = new Map<string, ContentCategory>();
  private readonly getEditors: () => LayoutEditorContribution[];

  constructor(options: FileRegistryOptions = {}) {
    this.getEditors = options.getEditors ?? (() => []);
  }

  public createFilesRegistry(): FilesRegistry {
    return {
      capabilities: this.createMimeCapabilityRegistry(),
      openFile: (input) => this.openFile(input),
      closeFile: (fileId) => this.closeFile(fileId),
      getFile: (fileId) => this.files.get(fileId),
      listFiles: () => this.list(),
      updateFile: (fileId, update) => this.updateFile(fileId, update),
      notifyChanged: (fileId) => this.notifyChanged(fileId),
      subscribe: (subscriber) => this.subscribe(subscriber),
      registerMimeResolver: (resolver) => {
        this.mimeResolvers.push(resolver);
      },
      registerEditorResolver: (resolver) => {
        this.editorResolvers.push(resolver);
      },
      classifyUri: (uri, hint) => this.classifyUri(uri, hint),
      resolveEditor: (file) => this.resolveEditor(file)
    };
  }

  private createMimeCapabilityRegistry(): MimeCapabilityRegistry {
    return {
      registerCapabilities: (mimeType, capabilities) => {
        let set = this.mimeCapabilities.get(mimeType);
        if (!set) {
          set = new Set();
          this.mimeCapabilities.set(mimeType, set);
        }
        for (const cap of capabilities) {
          set.add(cap);
        }
      },
      hasCapability: (mimeType, capability) => {
        const set = this.mimeCapabilities.get(mimeType);
        return set?.has(capability) ?? false;
      },
      registerContentCategory: (mimeType, category) => {
        this.mimeContentCategories.set(mimeType, category);
      },
      getContentCategory: (mimeType) => {
        return this.mimeContentCategories.get(mimeType);
      }
    };
  }

  public list(): FileEntity[] {
    return [...this.files.values()];
  }

  public snapshot(): FileEntity[] {
    return this.list();
  }

  public classifyUri(uri: string, hint?: MimeHint): string {
    if (hint?.declared) {
      return hint.declared;
    }
    const effectiveHint: MimeHint = {
      ...hint,
      extension: hint?.extension ?? extractExtension(uri)
    };
    for (const resolver of this.mimeResolvers) {
      const result = resolver(uri, effectiveHint);
      if (result) {
        return result;
      }
    }
    return DEFAULT_MIME_TYPE;
  }

  public resolveEditor(file: FileEntity): string | undefined {
    for (const resolver of this.editorResolvers) {
      const editorId = resolver(file);
      if (editorId) {
        return editorId;
      }
    }
    return this.matchEditorByMimeType(file.mimeType);
  }

  private matchEditorByMimeType(mimeType: string): string | undefined {
    for (const editor of this.getEditors()) {
      if (editor.supportedMimeTypes?.includes(mimeType)) {
        return editor.id;
      }
    }
    return undefined;
  }

  private openFile(input: FileOpenInput): FileEntity {
    const existing = this.findByUri(input.uri);
    if (existing) {
      return existing;
    }

    const entity: FileEntity = {
      fileId: generateFileId(),
      uri: input.uri,
      mimeType: input.mimeType,
      editorId: input.editorId,
      engineBinding: input.engineBinding,
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      version: 0,
      diskVersion: input.diskVersion,
      viewState: input.viewState,
      openedAt: new Date().toISOString()
    };

    this.files.set(entity.fileId, entity);
    this.emit();
    return entity;
  }

  private closeFile(fileId: string): void {
    if (this.files.delete(fileId)) {
      this.emit();
    }
  }

  private updateFile(
    fileId: string,
    update: FileEntityUpdate
  ): FileEntity | undefined {
    const existing = this.files.get(fileId);
    if (!existing) {
      return undefined;
    }

    const next: FileEntity = { ...existing, ...update };
    this.files.set(fileId, next);
    this.emit();
    return next;
  }

  private notifyChanged(fileId: string): FileEntity | undefined {
    const existing = this.files.get(fileId);
    if (!existing) {
      return undefined;
    }

    const next: FileEntity = {
      ...existing,
      version: existing.version + 1,
      dirtyVsBackend: existing.backendVersion !== existing.version + 1,
      dirtyVsDisk: existing.diskVersion !== existing.version + 1
    };
    this.files.set(fileId, next);
    this.emit();
    return next;
  }

  private subscribe(subscriber: FilesSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.list());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private findByUri(uri: string): FileEntity | undefined {
    for (const entity of this.files.values()) {
      if (entity.uri === uri) {
        return entity;
      }
    }
    return undefined;
  }

  private emit(): void {
    const snapshot = this.list();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }
}

function extractExtension(uri: string): string | undefined {
  const lastSlash = Math.max(uri.lastIndexOf("/"), uri.lastIndexOf("\\"));
  const tail = lastSlash >= 0 ? uri.slice(lastSlash + 1) : uri;
  const dot = tail.lastIndexOf(".");
  if (dot <= 0 || dot === tail.length - 1) {
    return undefined;
  }
  return tail.slice(dot + 1).toLowerCase();
}
