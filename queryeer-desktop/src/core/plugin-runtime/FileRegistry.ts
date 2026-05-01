import type {
  FileEntity,
  FileEntityUpdate,
  FileOpenInput,
  ViewStateBag
} from "../../contracts/files/FileEntity";
import { getFileStateRegistry } from "./FileStateRegistryImpl";
import type {
  EditorResolutionContext,
  ContentCategory,
  FileOpenIntent,
  FilesRegistry,
  FilesSubscriber,
  MimeCapability,
  MimeCapabilityRegistry,
  MimeIconContribution
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
  private readonly mimeIcons = new Map<string, MimeIconContribution>();
  private readonly getEditors: () => LayoutEditorContribution[];

  constructor(options: FileRegistryOptions = {}) {
    this.getEditors = options.getEditors ?? (() => []);
    this.registerDefaultCapabilities();
  }

  private registerDefaultCapabilities(): void {
    const commonTextTypes = [
      "text/plain",
      "text/markdown",
      "application/json",
      "application/xml",
      "application/sql",
      "application/plbsql",
      "application/yaml",
      "text/html",
      "text/css",
      "text/javascript",
      "text/typescript"
    ];
    for (const mimeType of commonTextTypes) {
      let set = this.mimeCapabilities.get(mimeType);
      if (!set) {
        set = new Set();
        this.mimeCapabilities.set(mimeType, set);
      }
      set.add("viewable");
      set.add("editable");
      set.add("backupable");
    }
  }

  public createFilesRegistry(): FilesRegistry {
    return {
      capabilities: this.createMimeCapabilityRegistry(),
      mimeIcons: this.createMimeIconRegistry(),
      openFile: (input) => this.openFile(input),
      closeFile: (fileId) => this.closeFile(fileId),
      getFile: (fileId) => this.files.get(fileId),
      listFiles: () => this.list(),
      updateFile: (fileId, update) => this.updateFile(fileId, update),
      subscribe: (subscriber) => this.subscribe(subscriber),
      registerMimeResolver: (resolver) => {
        this.mimeResolvers.push(resolver);
      },
      registerEditorResolver: (resolver) => {
        this.editorResolvers.push(resolver);
      },
      classifyUri: (uri, hint) => this.classifyUri(uri, hint),
      resolveEditor: (file, context) => this.resolveEditor(file, context),
      getEditorState: (fileId, editorKey) => this.getEditorState(fileId, editorKey),
      setEditorState: (fileId, editorKey, state) => this.setEditorState(fileId, editorKey, state),
      markDirty: (fileId) => this.markDirty(fileId)
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

  private createMimeIconRegistry() {
    return {
      registerMimeIcon: (contribution: MimeIconContribution) => {
        this.mimeIcons.set(contribution.mimeType, contribution);
      },
      getMimeIcon: (mimeType: string) => {
        const contribution = this.mimeIcons.get(mimeType);
        return contribution?.icon;
      },
      listMimeIcons: () => {
        return [...this.mimeIcons.values()];
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

  public resolveEditor(
    file: FileEntity,
    context?: Partial<EditorResolutionContext>
  ): string | undefined {
    const effectiveContext = this.buildEditorResolutionContext(file, context);
    for (const resolver of this.editorResolvers) {
      const editorId = resolver(file);
      if (editorId) {
        return editorId;
      }
    }
    return this.matchEditor(effectiveContext);
  }

  private buildEditorResolutionContext(
    file: FileEntity,
    context?: Partial<EditorResolutionContext>
  ): EditorResolutionContext {
    const mimeType = context?.mimeType ?? file.mimeType;
    return {
      uri: context?.uri ?? file.uri,
      mimeType,
      openIntent: context?.openIntent ?? this.defaultOpenIntent(mimeType),
      contentCategory: context?.contentCategory ?? this.mimeContentCategories.get(mimeType)
    };
  }

  private defaultOpenIntent(mimeType: string): FileOpenIntent {
    if (this.mimeCapabilities.get(mimeType)?.has("editable")) {
      return "edit";
    }
    return "view";
  }

  private matchEditor(context: EditorResolutionContext): string | undefined {
    const scored = this.getEditors()
      .map((editor) => {
        return {
          editor,
          score: this.scoreEditor(editor, context)
        };
      })
      .filter((candidate) => candidate.score !== undefined)
      .sort((a, b) => {
        const scoreDiff = (b.score ?? Number.NEGATIVE_INFINITY) - (a.score ?? Number.NEGATIVE_INFINITY);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        const priorityDiff = (b.editor.priority ?? 0) - (a.editor.priority ?? 0);
        if (priorityDiff !== 0) {
          return priorityDiff;
        }
        const orderDiff = (a.editor.order ?? 0) - (b.editor.order ?? 0);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return a.editor.id.localeCompare(b.editor.id);
      });

    if (scored.length > 0) {
      return scored[0]?.editor.id;
    }

    const fallback = this.getEditors().find((editor) => editor.id === "core.files.unsupported");
    return fallback?.id;
  }

  private scoreEditor(
    editor: LayoutEditorContribution,
    context: EditorResolutionContext
  ): number | undefined {
    const uriScheme = extractScheme(context.uri);
    if (editor.resourceScheme && editor.resourceScheme !== uriScheme) {
      return undefined;
    }

    let score = 0;
    let hasMatchSignal = false;

    const mimeScore = this.scoreMimeMatch(editor.supportedMimeTypes, context.mimeType);
    if (mimeScore !== undefined) {
      score += mimeScore;
      hasMatchSignal = true;
    }

    if (
      context.contentCategory &&
      editor.supportedContentCategories?.includes(context.contentCategory)
    ) {
      score += 220;
      hasMatchSignal = true;
    }

    if (editor.openIntents?.includes(context.openIntent)) {
      score += 100;
      hasMatchSignal = true;
    }

    const mimeCapabilities = this.mimeCapabilities.get(context.mimeType);
    const missingRequiredCapability = editor.requiredCapabilities?.some(
      (capability) => !mimeCapabilities?.has(capability)
    );
    if (missingRequiredCapability) {
      return undefined;
    }

    if (!hasMatchSignal) {
      return undefined;
    }

    return score;
  }

  private scoreMimeMatch(
    supportedMimeTypes: string[] | undefined,
    mimeType: string
  ): number | undefined {
    if (!supportedMimeTypes || supportedMimeTypes.length === 0) {
      return undefined;
    }
    let bestScore: number | undefined;
    for (const supportedMimeType of supportedMimeTypes) {
      if (supportedMimeType === mimeType) {
        bestScore = Math.max(bestScore ?? Number.NEGATIVE_INFINITY, 400);
        continue;
      }
      if (supportedMimeType === "*/*") {
        bestScore = Math.max(bestScore ?? Number.NEGATIVE_INFINITY, 100);
        continue;
      }
      if (supportedMimeType.endsWith("/*")) {
        const prefix = supportedMimeType.slice(0, -1);
        if (mimeType.startsWith(prefix)) {
          bestScore = Math.max(bestScore ?? Number.NEGATIVE_INFINITY, 300);
        }
      }
    }
    return bestScore;
  }

  private openFile(input: FileOpenInput): FileEntity {
    const existing = this.findByUri(input.uri);
    if (existing) {
      return existing;
    }

    const entity: FileEntity = {
      fileId: generateFileId(),
      version: 0,
      uri: input.uri,
      mimeType: input.mimeType,
      editorId: input.editorId,
      engineBinding: input.engineBinding,
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      persistentViewState: input.persistentViewState,
      openedAt: new Date().toISOString()
    };

    this.files.set(entity.fileId, entity);
    this.emit();
    return entity;
  }

  private closeFile(fileId: string): void {
    if (this.files.delete(fileId)) {
      getFileStateRegistry().evict(fileId);
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

  public getEditorState(fileId: string, editorKey: string): unknown {
    const file = this.files.get(fileId);
    if (!file?.persistentViewState) return null;
    const editorState = (file.persistentViewState as Record<string, unknown>)[editorKey];
    return editorState ?? null;
  }

  public setEditorState(fileId: string, editorKey: string, state: unknown): void {
    const file = this.files.get(fileId);
    if (!file) return;
    const bag = file.persistentViewState ?? {};
    const updatedBag = { ...bag, [editorKey]: state };
    this.updateFile(fileId, { persistentViewState: updatedBag as ViewStateBag });
  }

  public markDirty(fileId: string): void {
    const file = this.files.get(fileId);
    if (!file) {
      return;
    }
    this.updateFile(fileId, { dirtyVsDisk: true, version: file.version + 1 });
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

function extractScheme(uri: string): string | undefined {
  const colon = uri.indexOf(":");
  if (colon <= 0) {
    return undefined;
  }
  return uri.slice(0, colon);
}
