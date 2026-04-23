import type { FileEntity } from "../../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../../contracts/files/FilesRegistry";
import type { TextEditorApi } from "./TextEditorApi";

const MONACO_EDITOR_STATE_KEY = "monaco.editor";

export class ViewStateStore {
  private readonly runtimeByFileId: Map<string, unknown>;
  private readonly backupRestoredFileIds = new Set<string>();
  private filesRegistry: FilesRegistry | null = null;

  constructor(runtimeByFileId?: Map<string, unknown>) {
    this.runtimeByFileId = runtimeByFileId ?? new Map<string, unknown>();
  }

  setFilesRegistry(filesRegistry: FilesRegistry | null): void {
    this.filesRegistry = filesRegistry;
  }

  markBackupRestored(fileId: string): void {
    this.backupRestoredFileIds.add(fileId);
  }

  captureForFile(fileId: string, editorApi: TextEditorApi | null, capturedViewState?: unknown): void {
    const viewState = capturedViewState !== undefined
      ? capturedViewState
      : editorApi?.getViewState();
    if (viewState == null) {
      return;
    }
    this.runtimeByFileId.set(fileId, viewState);
    this.savePersistent(fileId, viewState);
  }

  resolveForFile(file: FileEntity): unknown {
    const fileId = file.fileId ?? "";
    const runtime = this.runtimeByFileId.get(fileId);
    if (runtime) {
      return runtime;
    }

    const persistent = this.getPersistentMonacoState(file);
    if (!persistent) {
      return null;
    }
    if (this.shouldRestorePersistent(file)) {
      this.backupRestoredFileIds.delete(fileId);
      return persistent;
    }
    return null;
  }

  applyToEditor(editorApi: TextEditorApi, file: FileEntity): void {
    const state = this.resolveForFile(file);
    if (state) {
      editorApi.setViewState(state);
    }
  }

  applyRuntimeToEditor(editorApi: TextEditorApi, fileId: string): boolean {
    const state = this.runtimeByFileId.get(fileId);
    if (!state) {
      return false;
    }
    editorApi.setViewState(state);
    return true;
  }

  getRuntime(fileId: string): unknown | undefined {
    return this.runtimeByFileId.get(fileId);
  }

  putRuntime(fileId: string, viewState: unknown): void {
    if (viewState == null) {
      this.runtimeByFileId.delete(fileId);
      return;
    }
    this.runtimeByFileId.set(fileId, viewState);
  }

  private savePersistent(fileId: string, viewState: unknown): void {
    if (!this.filesRegistry || !viewState) {
      return;
    }
    this.filesRegistry.setEditorState(fileId, MONACO_EDITOR_STATE_KEY, viewState);
  }

  private getPersistentMonacoState(file: FileEntity): unknown {
    const bag = file.persistentViewState;
    if (!bag) {
      return null;
    }
    const keyed = bag[MONACO_EDITOR_STATE_KEY];
    if (keyed !== undefined) {
      return keyed;
    }
    return bag;
  }

  private shouldRestorePersistent(file: FileEntity): boolean {
    if (!file.fileId) {
      return false;
    }
    if (!file.dirtyVsBackend && !file.dirtyVsDisk) {
      return true;
    }
    return this.backupRestoredFileIds.has(file.fileId);
  }
}
