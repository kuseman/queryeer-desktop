import type { FileEntity } from "../../../contracts/files/FileEntity";
import type { Disposable } from "./types";
import type { FilesRegistry } from "../../../contracts/files/FilesRegistry";
import type { ContextChain } from "../../core.commands/context-chain";
import { ContextPriority } from "../../core.commands/context-priority";
import { TextEditorModel } from "./TextEditorModel";
import { TextEditorApi } from "./TextEditorApi";
import { ViewStateStore } from "./ViewStateStore";
import { registerTextEditorRepository } from "./TextEditorModelRepository";

let registry: TextEditorRegistry | undefined;

export function getTextEditorRegistry(): TextEditorRegistry {
  if (!registry) {
    registry = new TextEditorRegistry();
    registerTextEditorRepository(registry);
  }
  return registry;
}

export function getAnyActiveEditor(): TextEditorApi | null {
  if (globalEditorByScopeId.size === 0) return null;
  return globalEditorByScopeId.values().next().value ?? null;
}

/** Module-level chain shared across all TextEditorRegistry instances. */
let globalContextChain: ContextChain | null = null;

/** Map from scope id → editor api, shared across all instances for cross-registry lookup. */
const globalEditorByScopeId = new Map<string, TextEditorApi>();

let nextScopeIndex = 0;

export function setTextEditorContextChain(chain: ContextChain): void {
  globalContextChain = chain;
}

export class TextEditorRegistry {
  private readonly modelsByFileId = new Map<string, TextEditorModel>();
  private readonly modelsByUri = new Map<string, TextEditorModel>();
  private readonly pendingRecoveredContentByFileId = new Map<string, string>();
  private readonly runtimeViewState = new Map<string, unknown>();
  private readonly viewStateStore = new ViewStateStore(this.runtimeViewState);
  private activeFileId: string | null = null;
  private editorApi: TextEditorApi | null = null;
  private listeners: Array<() => void> = [];
  private contentDirtyListeners: Array<(fileId: string, text: string) => void> = [];
  private filesRegistry: FilesRegistry | null = null;
  private pendingFileForEditor: FileEntity | null = null;
  private editorFocusDisposables: Disposable[] = [];
  private scopeId: string | null = null;
  private scopeUnregister: (() => void) | null = null;

  getCommandTargetEditor(): TextEditorApi | null {
    if (this.editorApi?.getModel()) {
      return this.editorApi;
    }
    const lastFocusedId = globalContextChain?.getLastFocusedScopeId(
      ContextPriority.EDITOR_INSTANCE
    );
    if (lastFocusedId) {
      const editor = globalEditorByScopeId.get(lastFocusedId);
      if (editor?.getModel()) {
        return editor;
      }
    }
    return null;
  }

  private wireEditorFocusTracking(api: TextEditorApi): void {
    for (const disposable of this.editorFocusDisposables) {
      disposable.dispose();
    }

    const focusDisposables: Disposable[] = [];

    const onFocus = (): void => {
      if (this.scopeId && globalContextChain) {
        globalContextChain.activate(this.scopeId);
        globalContextChain.update(this.scopeId, {
          hasActiveTextEditor: true,
          editorTextFocus: true,
          languageId: api.getModel()?.languageId
        });
      }
    };

    const onBlur = (): void => {
      if (this.scopeId && globalContextChain) {
        globalContextChain.update(this.scopeId, { hasActiveTextEditor: true, editorTextFocus: false });
      }
    };

    const focusText = (api as unknown as {
      onDidFocusEditorText?: (callback: () => void) => Disposable;
    }).onDidFocusEditorText;
    const blurText = (api as unknown as {
      onDidBlurEditorText?: (callback: () => void) => Disposable;
    }).onDidBlurEditorText;
    const focusWidget = (api as unknown as {
      onDidFocusEditorWidget?: (callback: () => void) => Disposable;
    }).onDidFocusEditorWidget;
    const blurWidget = (api as unknown as {
      onDidBlurEditorWidget?: (callback: () => void) => Disposable;
    }).onDidBlurEditorWidget;

    if (typeof focusText === "function") {
      focusDisposables.push(focusText.call(api, onFocus));
    }
    if (typeof blurText === "function") {
      focusDisposables.push(blurText.call(api, onBlur));
    }
    if (typeof focusWidget === "function") {
      focusDisposables.push(focusWidget.call(api, onFocus));
    }
    if (typeof blurWidget === "function") {
      focusDisposables.push(blurWidget.call(api, onBlur));
    }

    this.editorFocusDisposables = focusDisposables;
  }

  setFilesRegistry(registry: FilesRegistry): void {
    this.filesRegistry = registry;
    this.viewStateStore.setFilesRegistry(registry);
  }

  onEditorReady(api: TextEditorApi): void {
    this.editorApi = api;

    // Register a context scope for this editor instance.
    if (this.scopeId) {
      globalEditorByScopeId.delete(this.scopeId);
      this.scopeUnregister?.();
    }
    const scopeId = `core.editor.monaco.${nextScopeIndex++}`;
    this.scopeId = scopeId;
    globalEditorByScopeId.set(scopeId, api);
    if (globalContextChain) {
      this.scopeUnregister = globalContextChain.register({
        id: scopeId,
        priority: ContextPriority.EDITOR_INSTANCE,
        context: { hasActiveTextEditor: true, editorTextFocus: false }
      });
    }

    this.wireEditorFocusTracking(api);

    if (this.activeFileId) {
      const model = this.modelsByFileId.get(this.activeFileId);
      if (model) {
        api.setModel(model.getDocument());
        if (!this.viewStateStore.applyRuntimeToEditor(api, this.activeFileId)) {
          const file = this.filesRegistry?.getFile(this.activeFileId);
          if (file) {
            this.viewStateStore.applyToEditor(api, file);
          }
        }
        api.focus();
      }
    }

    if (this.pendingFileForEditor) {
      const file = this.pendingFileForEditor;
      const pendingModel = this.modelsByFileId.get(file.fileId ?? "");
      if (pendingModel) {
        this.pendingFileForEditor = null;
        api.setModel(pendingModel.getDocument());
        this.viewStateStore.applyToEditor(api, file);
        api.focus();
      }
    }

    this.notifyListeners();
  }

  private applyEditorStateForActiveFile(fileId: string): void {
    if (!this.editorApi) {
      return;
    }
    if (!this.viewStateStore.applyRuntimeToEditor(this.editorApi, fileId)) {
      const file = this.filesRegistry?.getFile(fileId);
      if (file) {
        this.viewStateStore.applyToEditor(this.editorApi, file);
      }
    }
  }

  markDirty(fileId: string): void {
    this.filesRegistry?.markDirty(fileId);
    const activeModel = this.modelsByFileId.get(fileId);
    if (activeModel) {
      const text = this.editorApi?.getContent();
      if (text !== undefined) {
        activeModel.setContent(text);
      }
    }
    if (this.contentDirtyListeners.length > 0) {
      const text = this.editorApi?.getContent();
      if (text !== undefined) {
        for (const listener of this.contentDirtyListeners) {
          listener(fileId, text);
        }
      }
    }
  }

  onContentDirty(listener: (fileId: string, text: string) => void): () => void {
    this.contentDirtyListeners.push(listener);
    return () => {
      const idx = this.contentDirtyListeners.indexOf(listener);
      if (idx !== -1) this.contentDirtyListeners.splice(idx, 1);
    };
  }

  applyRecoveredContent(fileId: string, text: string): void {
    this.viewStateStore.markBackupRestored(fileId);
    const model = this.modelsByFileId.get(fileId);
    if (model) {
      model.setContent(text);
      return;
    }
    this.pendingRecoveredContentByFileId.set(fileId, text);
  }

  private consumePendingRecoveredContent(fileId: string, model: TextEditorModel): void {
    const recovered = this.pendingRecoveredContentByFileId.get(fileId);
    if (recovered === undefined) {
      return;
    }
    model.setContent(recovered);
    this.pendingRecoveredContentByFileId.delete(fileId);
  }

  onEditorDisposed(capturedViewState?: unknown): void {
    this.captureActiveViewState(capturedViewState);
    for (const disposable of this.editorFocusDisposables) {
      disposable.dispose();
    }
    this.editorFocusDisposables = [];
    this.scopeUnregister?.();
    this.scopeUnregister = null;
    if (this.scopeId) {
      globalEditorByScopeId.delete(this.scopeId);
      this.scopeId = null;
    }
    this.editorApi = null;
    this.pendingFileForEditor = null;
    this.activeFileId = null;
  }

  captureActiveViewState(capturedViewState?: unknown): void {
    if (!this.activeFileId) {
      return;
    }
    this.viewStateStore.captureForFile(this.activeFileId, this.editorApi, capturedViewState);
  }

  openFile(file: FileEntity): void {
    const previousActiveFileId = this.activeFileId;
    if (previousActiveFileId && previousActiveFileId !== file.fileId) {
      this.viewStateStore.captureForFile(previousActiveFileId, this.editorApi);
    }

    let model = this.modelsByUri.get(file.uri);
    if (!model) {
      const modelToPopulate = new TextEditorModel(file.uri, file.mimeType, "");
      this.modelsByUri.set(file.uri, modelToPopulate);
      model = modelToPopulate;
    }
    if (file.fileId) {
      this.modelsByFileId.set(file.fileId, model);
      this.consumePendingRecoveredContent(file.fileId, model);
    }
    this.activeFileId = file.fileId ?? null;
    if (this.editorApi) {
      this.editorApi.setModel(model.getDocument());
      this.viewStateStore.applyToEditor(this.editorApi, file);
      this.editorApi.focus();
    }
    this.notifyListeners();
  }

  async openFileAsync(file: FileEntity): Promise<void> {
    const previousActiveFileId = this.activeFileId;
    if (previousActiveFileId && previousActiveFileId !== file.fileId) {
      this.viewStateStore.captureForFile(previousActiveFileId, this.editorApi);
    }

    let model = this.modelsByUri.get(file.uri);
    if (!model) {
      let content = "";
      try {
        const result = await (window.appShell as unknown as { readFile: (uri: string) => Promise<{ success: boolean; content: string }> }).readFile(file.uri);
        if (result.success) {
          content = result.content;
        }
      } catch {
        // File not yet readable, will populate on next open
      }
      model = new TextEditorModel(file.uri, file.mimeType, content);
      this.modelsByUri.set(file.uri, model);
    }
    if (file.fileId) {
      this.modelsByFileId.set(file.fileId, model);
      this.consumePendingRecoveredContent(file.fileId, model);
    }
    this.activeFileId = file.fileId ?? null;
    if (this.editorApi) {
      this.editorApi.setModel(model.getDocument());
      this.viewStateStore.applyToEditor(this.editorApi, file);
      this.editorApi.focus();
    } else {
      this.pendingFileForEditor = file;
    }
    this.notifyListeners();
  }

  getModelForFile(fileId: string): TextEditorModel | undefined {
    return this.modelsByFileId.get(fileId);
  }

  getModelForUri(uri: string): TextEditorModel | undefined {
    return this.modelsByUri.get(uri);
  }

  getActiveModel(): TextEditorModel | null {
    if (!this.activeFileId) return null;
    return this.modelsByFileId.get(this.activeFileId) ?? null;
  }

  getActiveEditor(): TextEditorApi | null {
    return this.editorApi;
  }

  getActiveFile(): FileEntity | null {
    if (!this.activeFileId) return null;
    return this.filesRegistry?.getFile(this.activeFileId) ?? null;
  }

  setActiveFileId(fileId: string | null): void {
    if (this.activeFileId && this.activeFileId !== fileId) {
      this.viewStateStore.captureForFile(this.activeFileId, this.editorApi);
    }
    this.activeFileId = fileId;
    if (this.editorApi) {
      if (fileId) {
        const model = this.modelsByFileId.get(fileId);
        if (model) {
          this.editorApi.setModel(model.getDocument());
          this.applyEditorStateForActiveFile(fileId);
          this.editorApi.focus();
        }
      } else {
        this.editorApi.setModel(null);
      }
    }
    this.notifyListeners();
  }

  updateModelContent(uri: string, content: string): void {
    const model = this.modelsByUri.get(uri);
    if (model) {
      const activeFile = this.getActiveFile();
      const shouldCapture = Boolean(activeFile?.uri === uri && this.editorApi);
      if (shouldCapture) {
        this.captureActiveViewState();
      }
      model.setContent(content);
      if (activeFile?.uri === uri && this.editorApi) {
        this.editorApi.setModel(model.getDocument());
        this.applyEditorStateForActiveFile(activeFile.fileId);
      }
    }
  }

  getRuntimeViewState(fileId: string): unknown | undefined {
    if (!fileId) {
      return undefined;
    }
    return this.viewStateStore.getRuntime(fileId);
  }

  applyRuntimeViewState(fileId: string, viewState: unknown): void {
    if (!fileId) {
      return;
    }
    this.viewStateStore.putRuntime(fileId, viewState);
    if (this.editorApi) {
      this.editorApi.setViewState(viewState);
    }
  }

  disposeModel(fileId: string): void {
    if (this.activeFileId === fileId) {
      this.viewStateStore.captureForFile(fileId, this.editorApi);
    }
    const model = this.modelsByFileId.get(fileId);
    if (model) {
      const uri = model.getUri();
      this.modelsByFileId.delete(fileId);
      const stillInUse = [...this.modelsByFileId.values()].some((m) => m.getUri() === uri);
      if (!stillInUse) {
        this.modelsByUri.delete(uri);
        model.dispose();
      }
    }
    if (this.activeFileId === fileId) {
      this.activeFileId = null;
    }
  }

  dispose(): void {
    for (const model of this.modelsByFileId.values()) {
      model.dispose();
    }
    this.modelsByFileId.clear();
    this.modelsByUri.clear();
    this.editorApi = null;
    this.activeFileId = null;
  }

  subscribe(listener: () => void): Disposable {
    this.listeners.push(listener);
    return {
      dispose: () => {
        const index = this.listeners.indexOf(listener);
        if (index !== -1) this.listeners.splice(index, 1);
      }
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
