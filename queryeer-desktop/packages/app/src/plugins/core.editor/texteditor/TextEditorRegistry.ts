import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { Disposable } from "./types";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { ContextChain } from "../../core.commands/context-chain";
import { ContextPriority } from "../../core.commands/context-priority";
import { TextEditorModel } from "./TextEditorModel";
import { TextEditorApi } from "./TextEditorApi";
import { ViewStateStore } from "./ViewStateStore";
import { registerTextEditorRepository } from "./TextEditorModelRepository";
import { inflateDottedKeys } from "../../../renderer/shell/context-value-flatten";

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

export function getEditorContextChain(): ContextChain | null {
  return globalContextChain;
}

type EditorInstanceState = {
  activeFileId: string | null;
  editorApi: TextEditorApi | null;
  pendingFileForEditor: FileEntity | null;
  pendingFileShouldFocus: boolean;
  editorFocusDisposables: Disposable[];
  editorFocusContext: EditorFocusContext | null;
  scopeId: string | null;
  scopeUnregister: (() => void) | null;
};

type EditorFocusContext = {
  hasActiveTextEditor: boolean;
  editorFocus: boolean;
  editorTextFocus: boolean;
  languageId: string | undefined;
  selectedText: string;
  hasSelection: boolean;
  editorInstanceId: string;
  activeEditorGroupId?: string;
};

type OpenFileOptions = {
  focus?: boolean;
};

const DEFAULT_EDITOR_INSTANCE_ID = "__default_editor_instance__";

export class TextEditorRegistry {
  private readonly modelsByFileId = new Map<string, TextEditorModel>();
  private readonly modelsByUri = new Map<string, TextEditorModel>();
  private readonly pendingRecoveredContentByFileId = new Map<string, string>();
  private readonly runtimeViewState = new Map<string, unknown>();
  private readonly viewStateStore = new ViewStateStore(this.runtimeViewState);
  private readonly instanceStateByInstanceId = new Map<string, EditorInstanceState>();
  private listeners: Array<() => void> = [];
  private contentDirtyListeners: Array<(fileId: string, text: string) => void> = [];
  private filesRegistry: FilesRegistry | null = null;
  private filesRegistryUnsubscribe: (() => void) | null = null;

  constructor() {
    registerTextEditorRepository(this);
  }

  private resolveInstanceId(editorInstanceId?: string): string {
    return editorInstanceId ?? DEFAULT_EDITOR_INSTANCE_ID;
  }

  private getEditorState(editorInstanceId?: string): EditorInstanceState {
    const resolvedInstanceId = this.resolveInstanceId(editorInstanceId);
    let state = this.instanceStateByInstanceId.get(resolvedInstanceId);
    if (!state) {
      state = {
        activeFileId: null,
        editorApi: null,
        pendingFileForEditor: null,
        pendingFileShouldFocus: true,
        editorFocusDisposables: [],
        editorFocusContext: null,
        scopeId: null,
        scopeUnregister: null
      };
      this.instanceStateByInstanceId.set(resolvedInstanceId, state);
    }
    return state;
  }

  private peekEditorState(editorInstanceId?: string): EditorInstanceState | undefined {
    return this.instanceStateByInstanceId.get(this.resolveInstanceId(editorInstanceId));
  }

  getCommandTargetEditor(): TextEditorApi | null {
    const lastFocusedId = globalContextChain?.getLastFocusedScopeId(
      ContextPriority.EDITOR_INSTANCE
    );
    if (lastFocusedId) {
      const editor = globalEditorByScopeId.get(lastFocusedId);
      if (editor?.getModel()) {
        return editor;
      }
    }

    for (const state of this.instanceStateByInstanceId.values()) {
      if (state.editorApi?.getModel()) {
        return state.editorApi;
      }
    }

    return null;
  }

  private wireEditorFocusTracking(api: TextEditorApi, editorInstanceId?: string): void {
    const resolvedInstanceId = this.resolveInstanceId(editorInstanceId);
    const state = this.getEditorState(resolvedInstanceId);
    for (const disposable of state.editorFocusDisposables) {
      disposable.dispose();
    }

    const focusDisposables: Disposable[] = [];

    // Shared mutable context object — updated in-place so each callback publishes the full picture.
    // languageId is left undefined until the first focus event (matching original behaviour).
    const scopeCtx: EditorFocusContext = {
      hasActiveTextEditor: true,
      editorFocus: false,
      editorTextFocus: false,
      languageId: undefined,
      selectedText: "",
      hasSelection: false,
      editorInstanceId: resolvedInstanceId,
      activeEditorGroupId: parseEditorGroupId(resolvedInstanceId)
    };
    state.editorFocusContext = scopeCtx;

    const publish = (): void => {
      if (state.scopeId && globalContextChain) {
        globalContextChain.update(state.scopeId, this.buildEditorInstanceContext(state));
      }
    };

    const onFocus = (): void => {
      if (state.scopeId && globalContextChain) {
        globalContextChain.activate(state.scopeId);
        scopeCtx.editorFocus = true;
        scopeCtx.editorTextFocus = true;
        scopeCtx.languageId = api.getModel()?.languageId;
        publish();
      }
    };

    const onBlur = (): void => {
      scopeCtx.editorFocus = false;
      scopeCtx.editorTextFocus = false;
      publish();
    };

    const onSelectionChange = (): void => {
      const selection = api.getSelection();
      const hasSelection = selection ? !isEmptySelection(selection) : false;
      const selected = hasSelection ? (api.getSelectedText() ?? "") : "";
      if (scopeCtx.selectedText === selected && scopeCtx.hasSelection === hasSelection) {
        return;
      }
      scopeCtx.selectedText = selected;
      scopeCtx.hasSelection = hasSelection;
      publish();
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

    const onChangeCursorSelection = (api as unknown as {
      onDidChangeCursorSelection?: (callback: (event: unknown) => void) => Disposable;
    }).onDidChangeCursorSelection;
    if (typeof onChangeCursorSelection === "function") {
      focusDisposables.push(onChangeCursorSelection.call(api, onSelectionChange));
    }

    state.editorFocusDisposables = focusDisposables;
  }

  private publishEditorInstanceContext(editorInstanceId?: string): void {
    const state = this.peekEditorState(editorInstanceId);
    this.publishEditorInstanceContextForState(state);
  }

  private publishEditorInstanceContextForState(state: EditorInstanceState | undefined): void {
    if (!state?.scopeId || !state.editorFocusContext || !globalContextChain) {
      return;
    }
    globalContextChain.update(state.scopeId, this.buildEditorInstanceContext(state));
  }

  private publishAllEditorInstanceContexts(): void {
    for (const state of this.instanceStateByInstanceId.values()) {
      this.publishEditorInstanceContextForState(state);
    }
  }

  private buildEditorInstanceContext(state: EditorInstanceState): Record<string, unknown> {
    const focusContext = state.editorFocusContext;
    if (!focusContext) {
      return { hasActiveTextEditor: true, editorFocus: false, editorTextFocus: false };
    }

    const { activeEditorGroupId, editorInstanceId, ...baseFocusContext } = focusContext;
    const isFocused = baseFocusContext.editorFocus || baseFocusContext.editorTextFocus;
    return {
      ...(isFocused ? this.buildActiveFileContext(state.activeFileId) : {}),
      ...baseFocusContext,
      ...(isFocused
        ? {
            editorInstanceId,
            ...(activeEditorGroupId ? { activeEditorGroupId } : {})
          }
        : {})
    };
  }

  private buildActiveFileContext(fileId: string | null): Record<string, unknown> {
    const activeFile = fileId ? this.filesRegistry?.getFile(fileId) : undefined;
    return {
      activeFileId: activeFile?.fileId ?? null,
      hasActiveFile: activeFile != null,
      activeFile: activeFile
        ? {
            fileId: activeFile.fileId,
            uri: activeFile.uri,
            editorId: activeFile.editorId,
            mimeType: activeFile.mimeType,
            metadata: inflateDottedKeys(activeFile.metadata ?? {}),
            engineBinding: activeFile.engineBinding
          }
        : null,
      hasActiveQueryExecutableFile: activeFile
        ? this.filesRegistry?.capabilities?.hasCapability(activeFile.mimeType, "queryexecutable") === true
        : false
    };
  }

  setFilesRegistry(registry: FilesRegistry): void {
    this.filesRegistryUnsubscribe?.();
    this.filesRegistry = registry;
    this.viewStateStore.setFilesRegistry(registry);
    this.filesRegistryUnsubscribe = registry.subscribe?.(() => {
      this.publishAllEditorInstanceContexts();
    }) ?? null;
  }

  onEditorReady(api: TextEditorApi, editorInstanceId?: string): void {
    const resolvedInstanceId = this.resolveInstanceId(editorInstanceId);
    const state = this.getEditorState(resolvedInstanceId);
    state.editorApi = api;

    // Register a context scope for this editor instance.
    if (state.scopeId) {
      globalEditorByScopeId.delete(state.scopeId);
      state.scopeUnregister?.();
    }
    const scopeId = `core.editor.monaco.${nextScopeIndex++}`;
    state.scopeId = scopeId;
    globalEditorByScopeId.set(scopeId, api);
    if (globalContextChain) {
      state.scopeUnregister = globalContextChain.register({
        id: scopeId,
        priority: ContextPriority.EDITOR_INSTANCE,
        context: {
          hasActiveTextEditor: true,
          editorFocus: false,
          editorTextFocus: false
        }
      });
    } else {
      state.scopeUnregister = null;
    }

    this.wireEditorFocusTracking(api, resolvedInstanceId);

    if (state.activeFileId) {
      const model = this.modelsByFileId.get(state.activeFileId);
      if (model) {
        api.setModel(model.getDocument());
        if (!this.viewStateStore.applyRuntimeToEditor(api, state.activeFileId)) {
          const file = this.filesRegistry?.getFile(state.activeFileId);
          if (file) {
            this.viewStateStore.applyToEditor(api, file);
          }
        }
        api.focus();
      }
    }

    if (state.pendingFileForEditor) {
      const file = state.pendingFileForEditor;
      const pendingModel = this.modelsByFileId.get(file.fileId ?? "");
      if (pendingModel) {
        state.pendingFileForEditor = null;
        api.setModel(pendingModel.getDocument());
        this.viewStateStore.applyToEditor(api, file);
        if (state.pendingFileShouldFocus) {
          api.focus();
        }
        state.pendingFileShouldFocus = true;
      }
    }

    this.notifyListeners();
  }

  private applyEditorStateForActiveFile(fileId: string, editorInstanceId?: string): void {
    const state = this.peekEditorState(editorInstanceId);
    if (!state?.editorApi) {
      return;
    }
    if (!this.viewStateStore.applyRuntimeToEditor(state.editorApi, fileId)) {
      const file = this.filesRegistry?.getFile(fileId);
      if (file) {
        this.viewStateStore.applyToEditor(state.editorApi, file);
      }
    }
  }

  markDirty(fileId: string, editorInstanceId?: string): void {
    this.filesRegistry?.markDirty(fileId);
    try {
      const text = this.peekEditorState(editorInstanceId)?.editorApi?.getContent();
      if (text === undefined) {
        return;
      }
      const activeModel = this.modelsByFileId.get(fileId);
      if (activeModel) {
        activeModel.setContent(text);
      }
      for (const listener of this.contentDirtyListeners) {
        listener(fileId, text);
      }
    } catch {
      // File content too large to materialize as a string; dirty flag still set above
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
    // Mark file dirty and trigger backup without using markDirty(), which
    // would clobber the content via editorApi.getContent() -> setContent()
    // since the editor hasn't switched to this model yet.
    this.filesRegistry?.markDirty(fileId);
    for (const listener of this.contentDirtyListeners) {
      listener(fileId, recovered);
    }
  }

  onEditorDisposed(capturedViewState?: unknown, editorInstanceId?: string): void {
    const resolvedInstanceId = this.resolveInstanceId(editorInstanceId);
    const state = this.getEditorState(resolvedInstanceId);
    this.captureActiveViewState(capturedViewState, resolvedInstanceId);
    for (const disposable of state.editorFocusDisposables) {
      disposable.dispose();
    }
    state.editorFocusDisposables = [];
    state.scopeUnregister?.();
    state.scopeUnregister = null;
    if (state.scopeId) {
      globalEditorByScopeId.delete(state.scopeId);
      state.scopeId = null;
    }
    state.editorApi = null;
    state.pendingFileForEditor = null;
    state.pendingFileShouldFocus = true;
    state.activeFileId = null;
    state.editorFocusContext = null;
    this.instanceStateByInstanceId.delete(resolvedInstanceId);
  }

  captureActiveViewState(capturedViewState?: unknown, editorInstanceId?: string): void {
    const state = this.peekEditorState(editorInstanceId);
    if (!state?.activeFileId) {
      return;
    }
    this.viewStateStore.captureForFile(state.activeFileId, state.editorApi, capturedViewState);
  }

  openFile(file: FileEntity, editorInstanceId?: string, options: OpenFileOptions = {}): void {
    const state = this.getEditorState(editorInstanceId);
    const previousActiveFileId = state.activeFileId;
    if (previousActiveFileId && previousActiveFileId !== file.fileId) {
      this.viewStateStore.captureForFile(previousActiveFileId, state.editorApi);
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
    state.activeFileId = file.fileId ?? null;
    this.publishEditorInstanceContext(editorInstanceId);
    if (state.editorApi) {
      state.editorApi.setModel(model.getDocument());
      this.viewStateStore.applyToEditor(state.editorApi, file);
      if (options.focus !== false) {
        state.editorApi.focus();
      }
    }
    this.notifyListeners();
  }

  async openFileAsync(file: FileEntity, editorInstanceId?: string, options: OpenFileOptions = {}): Promise<void> {
    const state = this.getEditorState(editorInstanceId);
    const previousActiveFileId = state.activeFileId;
    if (previousActiveFileId && previousActiveFileId !== file.fileId) {
      this.viewStateStore.captureForFile(previousActiveFileId, state.editorApi);
    }

    let model = this.modelsByUri.get(file.uri);
    if (!model) {
      let content = "";
      try {
        type ReadFileResult = { success: boolean; content: string; tooLarge?: boolean; fileSizeBytes?: number };
        type AppShell = {
          readFile: (uri: string) => Promise<ReadFileResult>;
          showDialogMessage: (opts: { title: string; message: string; severity?: string }) => Promise<unknown>;
        };
        const appShell = window.appShell as unknown as AppShell;
        const result = await appShell.readFile(file.uri);
        if (result.tooLarge) {
          const mb = Math.round((result.fileSizeBytes ?? 0) / (1024 * 1024));
          if (file.fileId) {
            this.filesRegistry?.closeFile(file.fileId);
          }
          await appShell.showDialogMessage({
            title: "File too large",
            message: `This file is too large to open (${mb} MB). The maximum supported file size is 512 MB.`,
            severity: "error"
          });
          return;
        }
        if (result.success) {
          content = result.content;
        }
      } catch {
        // File not yet readable, will populate on next open
      }

      const existingModel = this.modelsByUri.get(file.uri);
      if (existingModel) {
        model = existingModel;
      } else {
        model = new TextEditorModel(file.uri, file.mimeType, content);
        this.modelsByUri.set(file.uri, model);
      }
    }
    if (file.fileId) {
      this.modelsByFileId.set(file.fileId, model);
      this.consumePendingRecoveredContent(file.fileId, model);
    }
    state.activeFileId = file.fileId ?? null;
    this.publishEditorInstanceContext(editorInstanceId);
    if (state.editorApi) {
      state.editorApi.setModel(model.getDocument());
      this.viewStateStore.applyToEditor(state.editorApi, file);
      if (options.focus !== false) {
        state.editorApi.focus();
      }
    } else {
      state.pendingFileForEditor = file;
      state.pendingFileShouldFocus = options.focus !== false;
    }
    this.notifyListeners();
  }

  getModelForFile(fileId: string): TextEditorModel | undefined {
    return this.modelsByFileId.get(fileId);
  }

  getModelForUri(uri: string): TextEditorModel | undefined {
    return this.modelsByUri.get(uri);
  }

  getActiveModel(editorInstanceId?: string): TextEditorModel | null {
    const activeFileId = this.peekEditorState(editorInstanceId)?.activeFileId;
    if (!activeFileId) return null;
    return this.modelsByFileId.get(activeFileId) ?? null;
  }

  getActiveEditor(editorInstanceId?: string): TextEditorApi | null {
    return this.peekEditorState(editorInstanceId)?.editorApi ?? null;
  }

  getActiveFile(editorInstanceId?: string): FileEntity | null {
    const activeFileId = this.peekEditorState(editorInstanceId)?.activeFileId;
    if (!activeFileId) return null;
    return this.filesRegistry?.getFile(activeFileId) ?? null;
  }

  setActiveFileId(fileId: string | null, editorInstanceId?: string): void {
    const state = this.getEditorState(editorInstanceId);
    if (state.activeFileId && state.activeFileId !== fileId) {
      this.viewStateStore.captureForFile(state.activeFileId, state.editorApi);
    }
    state.activeFileId = fileId;
    this.publishEditorInstanceContext(editorInstanceId);
    if (state.editorApi) {
      if (fileId) {
        const model = this.modelsByFileId.get(fileId);
        if (model) {
          state.editorApi.setModel(model.getDocument());
          this.applyEditorStateForActiveFile(fileId, editorInstanceId);
          state.editorApi.focus();
        }
      } else {
        state.editorApi.setModel(null);
      }
    }
    this.notifyListeners();
  }

  updateModelContent(uri: string, content: string): void {
    const model = this.modelsByUri.get(uri);
    if (model) {
      const activeByInstance = [...this.instanceStateByInstanceId.entries()]
        .map(([instanceId, state]) => {
          const activeFileId = state.activeFileId;
          if (!activeFileId || !state.editorApi) {
            return null;
          }
          const activeFile = this.filesRegistry?.getFile(activeFileId);
          if (!activeFile || activeFile.uri !== uri) {
            return null;
          }
          return { instanceId, activeFileId };
        })
        .filter((value): value is { instanceId: string; activeFileId: string } => Boolean(value));

      for (const active of activeByInstance) {
        this.captureActiveViewState(undefined, active.instanceId);
      }

      model.setContent(content);

      for (const active of activeByInstance) {
        const editor = this.peekEditorState(active.instanceId)?.editorApi;
        if (!editor) {
          continue;
        }
        editor.setModel(model.getDocument());
        this.applyEditorStateForActiveFile(active.activeFileId, active.instanceId);
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
    for (const state of this.instanceStateByInstanceId.values()) {
      if (state.activeFileId === fileId && state.editorApi) {
        state.editorApi.setViewState(viewState);
      }
    }
  }

  disposeModel(fileId: string): void {
    for (const state of this.instanceStateByInstanceId.values()) {
      if (state.activeFileId === fileId) {
        this.viewStateStore.captureForFile(fileId, state.editorApi);
      }
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

    for (const state of this.instanceStateByInstanceId.values()) {
      if (state.activeFileId === fileId) {
        state.activeFileId = null;
        this.publishEditorInstanceContextForState(state);
      }
    }
  }

  dispose(): void {
    for (const model of this.modelsByFileId.values()) {
      model.dispose();
    }
    this.modelsByFileId.clear();
    this.modelsByUri.clear();
    for (const state of this.instanceStateByInstanceId.values()) {
      for (const disposable of state.editorFocusDisposables) {
        disposable.dispose();
      }
      state.editorFocusDisposables = [];
      state.scopeUnregister?.();
      if (state.scopeId) {
        globalEditorByScopeId.delete(state.scopeId);
      }
      state.scopeId = null;
      state.scopeUnregister = null;
      state.editorApi = null;
      state.activeFileId = null;
      state.editorFocusContext = null;
      state.pendingFileForEditor = null;
    }
    this.instanceStateByInstanceId.clear();
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

function isEmptySelection(selection: {
  selectionStartLineNumber: number;
  selectionStartColumn: number;
  positionLineNumber: number;
  positionColumn: number;
}): boolean {
  return selection.selectionStartLineNumber === selection.positionLineNumber
    && selection.selectionStartColumn === selection.positionColumn;
}

function parseEditorGroupId(editorInstanceId: string): string | undefined {
  const separatorIndex = editorInstanceId.indexOf(":");
  return separatorIndex > 0 ? editorInstanceId.slice(0, separatorIndex) : undefined;
}
