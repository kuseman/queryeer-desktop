import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { DialogSeverity, DialogOption } from "../../contracts/extensions/DialogExtension";
import type {
  FileWatcherEvent,
  FileWatcherService,
  FileWatcherSubscription
} from "../../contracts/files/FileWatcher";
import {
  WORKSPACE_SCHEMA_VERSION,
  type PersistedFileEntry,
  type PersistedLayoutSnapshot,
  type WorkspaceSnapshot
} from "../../contracts/workspace/WorkspaceSnapshot";
import { getTextEditorRegistry } from "../../plugins/core.editor/TextEditor/TextEditorRegistry";
import { getTextEditorRepositoryStates } from "../../plugins/core.editor/TextEditor/TextEditorModelRepository";

export type WorkspaceBridge = {
  getWorkspace: () => Promise<WorkspaceSnapshot>;
  saveWorkspace: (snapshot: WorkspaceSnapshot) => Promise<{ accepted: boolean }>;
  saveBackup: (fileId: string, text: string) => Promise<{ backupUri: string }>;
  purgeBackups: (fileId: string) => Promise<{ purged: number }>;
  listBackups: (fileId: string) => Promise<{ backupPaths: string[] }>;
  readLatestBackup: (
    fileId: string
  ) => Promise<{ text: string; savedAt: string; backupUri: string } | null>;
};

export type PendingRestoreEntry = {
  fileId: string;
  uri: string;
  backupFileId: string;
  backupUri: string;
};

export type RendererWorkspaceServiceOptions = {
  bridge: WorkspaceBridge;
  filesRegistry: FilesRegistry;
  fileMediator: FileMediator;
  fileWatcher: FileWatcherService;
  showDialog: (options: {
    title: string;
    message: string;
    severity?: DialogSeverity;
    detail?: string;
    options?: DialogOption[];
  }) => Promise<{ action: string }>;
  applyRecoveredContent?: (fileId: string, text: string) => void;
  debounceMs?: number;
  backupDebounceMs?: number;
  backupMaxIntervalMs?: number;
  now?: () => Date;
};

type AutosaveState = {
  latestText: string;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  maxIntervalTimer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_BACKUP_DEBOUNCE_MS = 3_000;
const DEFAULT_BACKUP_MAX_INTERVAL_MS = 30_000;

function stableBackupIdForUri(uri: string): string {
  let hash = 2166136261;
  for (let i = 0; i < uri.length; i += 1) {
    hash ^= uri.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `bkp-${(hash >>> 0).toString(16)}`;
}

export class RendererWorkspaceService {
  private readonly bridge: WorkspaceBridge;
  private readonly filesRegistry: FilesRegistry;
  private readonly fileMediator: FileMediator;
  private readonly fileWatcher: FileWatcherService;
  private readonly showDialog: RendererWorkspaceServiceOptions["showDialog"];
  private readonly applyRecoveredContent: (fileId: string, text: string) => void;
  private readonly debounceMs: number;
  private readonly backupDebounceMs: number;
  private readonly backupMaxIntervalMs: number;
  private readonly now: () => Date;
  private unsubscribeFromFiles: (() => void) | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;
  private activeFileId: string | null = null;
  private restoredLayoutSnapshot: PersistedLayoutSnapshot | null = null;
  private layout: PersistedLayoutSnapshot | null = null;
  private readonly watcherSubs = new Map<string, FileWatcherSubscription>();
  private readonly watcherSubsPending = new Map<string, Promise<void>>();
  private readonly autosaveStates = new Map<string, AutosaveState>();
  private readonly backupFileIdByFileId = new Map<string, string>();
  private readonly externalPromptInFlight = new Set<string>();
  private readonly lastDirtyAtByFileId = new Map<string, number>();
  private readonly externalPromptRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private activeFileSnapshotProvider: (() => string | null) | null = null;

  public constructor(options: RendererWorkspaceServiceOptions) {
    this.bridge = options.bridge;
    this.filesRegistry = options.filesRegistry;
    this.fileMediator = options.fileMediator;
    this.fileWatcher = options.fileWatcher;
    this.showDialog = options.showDialog;
    this.applyRecoveredContent = options.applyRecoveredContent ?? ((fileId, text) => {
      for (const repo of getTextEditorRepositoryStates()) {
        repo.applyRecoveredContent(fileId, text);
      }
    });
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.backupDebounceMs = options.backupDebounceMs ?? DEFAULT_BACKUP_DEBOUNCE_MS;
    this.backupMaxIntervalMs = options.backupMaxIntervalMs ?? DEFAULT_BACKUP_MAX_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
  }

  public async hydrate(): Promise<void> {
    const snapshot = await this.bridge.getWorkspace();

    const fileEntities = await Promise.all(
      snapshot.files.map((entry) =>
        this.fileMediator.openFile(entry.uri, {
          mimeType: entry.mimeType,
          editorId: entry.editorId,
          engineBinding: entry.engineBinding,
          persistentViewState: entry.persistentViewState
        })
      )
    );

    await Promise.all(
      snapshot.files.map((entry, i) => {
        if (!entry.backupFileId) {
          return Promise.resolve();
        }
        this.backupFileIdByFileId.set(fileEntities[i].fileId, entry.backupFileId);
        return this.restoreFileContentFromBackup(fileEntities[i].fileId, entry.backupFileId);
      })
    );

    if (snapshot.activeFileUri) {
      const entity = fileEntities.find((f) => f.uri === snapshot.activeFileUri);
      if (entity) {
        this.activeFileId = entity.fileId;
      }
    }
    this.restoredLayoutSnapshot = snapshot.layout ?? null;
    this.layout = snapshot.layout ?? null;

    this.hydrated = true;
    this.unsubscribeFromFiles = this.filesRegistry.subscribe((files) => {
      this.recordDirtyTransitions(files);
      this.scheduleSave();
      this.syncWatchers(files);
      this.syncBackups(files);
    });
    this.syncWatchers(this.filesRegistry.listFiles());
    this.syncBackups(this.filesRegistry.listFiles());
  }

  private async restoreFileContentFromBackup(
    fileId: string,
    backupFileId: string
  ): Promise<void> {
    try {
      const latest = await this.bridge.readLatestBackup(backupFileId);
      if (!latest) {
        return;
      }
      this.filesRegistry.updateFile(fileId, {
        dirtyVsDisk: true,
        backupUri: latest.backupUri,
        hasRecoveredBackup: false
      });
      this.applyRecoveredContent(fileId, latest.text);
    } catch {
      // best-effort; if backup can't be read we continue with disk content
    }
  }

  public handleFileChanged(file: FileEntity, text: string): void {
    if (!this.hydrated) {
      return;
    }
    let state = this.autosaveStates.get(file.fileId);
    if (!state) {
      state = { latestText: text, debounceTimer: null, maxIntervalTimer: null };
      this.autosaveStates.set(file.fileId, state);
    } else {
      state.latestText = text;
    }

    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
      void this.fireBackup(file.fileId);
    }, this.backupDebounceMs);

    if (state.maxIntervalTimer === null) {
      state.maxIntervalTimer = setTimeout(() => {
        void this.fireBackup(file.fileId);
      }, this.backupMaxIntervalMs);
    }
  }

  public hasRestoredFiles(): boolean {
    return this.hydrated && this.filesRegistry.listFiles().length > 0;
  }

  public restoredActiveFileId(): string | null {
    return this.activeFileId;
  }

  public setActiveFileSnapshotProvider(provider: () => string | null): void {
    this.activeFileSnapshotProvider = provider;
  }

  private getFileName(file: FileEntity): string {
    if (file.uri.startsWith("file://")) {
      return file.uri.split("/").pop() ?? file.uri;
    }
    if (file.uri.startsWith("untitled:")) {
      return file.uri.slice(8);
    }
    return file.uri;
  }

  public setActiveFileId(fileId: string | null): void {
    const wasSameFile = this.activeFileId === fileId;
    this.activeFileId = fileId;
    this.fileMediator.setActiveFileId(fileId);
    if (!this.hydrated) {
      return;
    }
    if (!wasSameFile) {
      this.scheduleSave();
    }
    if (fileId) {
      const file = this.filesRegistry.getFile(fileId);
      if (!file) {
        return;
      }

      if (file.diskState === "deletedOnDisk") {
        void this.handleDeletedFile(file);
        return;
      }

      if (file.diskState === "modifiedOnDisk") {
        if (file.dirtyVsDisk) {
          if (!this.externalPromptInFlight.has(file.fileId)) {
            this.externalPromptInFlight.add(file.fileId);
            void this.handleExternallyModifiedDirtyFile(file).finally(() => {
              this.externalPromptInFlight.delete(file.fileId);
            });
          }
          return;
        }
        void this.fileMediator.reloadFile(fileId);
      }
    }
  }

  private async handleDeletedFile(file: FileEntity): Promise<void> {
    const fileName = this.getFileName(file);
    const result = await this.showDialog({
      title: "File Deleted",
      message: `The file "${fileName}" has been deleted on disk.`,
      severity: "warning",
      detail: "Do you want to keep the file in the editor or close it?",
      options: [
        { label: "Keep File", value: "keep" },
        { label: "Close File", value: "close" }
      ]
    });

    if (result.action === "keep") {
      await this.fileMediator.discardExternalChange(file.fileId);
    } else if (result.action === "close") {
      await this.fileMediator.closeFile(file.fileId, { discardDirty: true });
    }
  }

  private async handleExternallyModifiedDirtyFile(file: FileEntity): Promise<void> {
    const fileName = this.getFileName(file);
    const result = await this.showDialog({
      title: "File Changed",
      message: `The file "${fileName}" has been modified on disk.`,
      severity: "warning",
      detail:
        "You have unsaved changes. Do you want to keep your changes or reload from disk?",
      options: [
        { label: "Keep My Changes", value: "keep" },
        { label: "Reload from Disk", value: "reload" }
      ]
    });

    if (result.action === "keep") {
      await this.fileMediator.discardExternalChange(file.fileId);
    } else if (result.action === "reload") {
      await this.fileMediator.reloadFile(file.fileId);
    }
  }

  public restoredLayout(): PersistedLayoutSnapshot | null {
    return this.restoredLayoutSnapshot;
  }

  public listPendingRestores(): PendingRestoreEntry[] {
    const entries: PendingRestoreEntry[] = [];
    for (const file of this.filesRegistry.listFiles()) {
      if (file.hasRecoveredBackup && file.backupUri) {
        const backupFileId = this.backupFileIdByFileId.get(file.fileId);
        if (!backupFileId) {
          continue;
        }
        entries.push({
          fileId: file.fileId,
          uri: file.uri,
          backupFileId,
          backupUri: file.backupUri
        });
      }
    }
    return entries;
  }

  public async readBackup(
    fileId: string
  ): Promise<{ text: string; savedAt: string; backupUri: string } | null> {
    const backupFileId = this.backupFileIdByFileId.get(fileId);
    if (!backupFileId) {
      return null;
    }
    return this.bridge.readLatestBackup(backupFileId);
  }

  public async discardBackup(fileId: string): Promise<void> {
    const backupFileId = this.backupFileIdByFileId.get(fileId);
    if (backupFileId) {
      await this.bridge.purgeBackups(backupFileId);
    }
    this.backupFileIdByFileId.delete(fileId);
    this.clearAutosave(fileId);
    this.filesRegistry.updateFile(fileId, {
      backupUri: undefined,
      hasRecoveredBackup: false
    });
  }

  public setLayout(layout: PersistedLayoutSnapshot): void {
    this.layout = layout;
    if (this.hydrated) {
      this.scheduleSave();
    }
  }

  public async flush(): Promise<void> {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    await this.pushSnapshot();
  }

  public dispose(): void {
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    this.unsubscribeFromFiles?.();
    this.unsubscribeFromFiles = null;
    for (const sub of this.watcherSubs.values()) {
      void sub.unsubscribe();
    }
    this.watcherSubs.clear();
    this.watcherSubsPending.clear();
    for (const timer of this.externalPromptRetryTimers.values()) {
      clearTimeout(timer);
    }
    this.externalPromptRetryTimers.clear();
    for (const fileId of [...this.autosaveStates.keys()]) {
      this.clearAutosave(fileId);
    }
  }

  private async fireBackup(fileId: string): Promise<void> {
    const state = this.autosaveStates.get(fileId);
    if (!state) {
      return;
    }
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    if (state.maxIntervalTimer !== null) {
      clearTimeout(state.maxIntervalTimer);
      state.maxIntervalTimer = null;
    }
    const file = this.filesRegistry.getFile(fileId);
    if (!file) {
      return;
    }
    const isUntitled = file.uri.startsWith("untitled:");
    const isDirty = isUntitled || file.dirtyVsDisk;
    if (!isDirty) {
      return;
    }
    if (!hasMeaningfulContent(state.latestText)) {
      return;
    }
    if (!isUntitled && !this.filesRegistry.capabilities.hasCapability(file.mimeType, "backupable")) {
      return;
    }
    const backupFileId = this.getOrAssignBackupFileId(fileId);
    try {
      const { backupUri } = await this.bridge.saveBackup(
        backupFileId,
        state.latestText
      );
      this.filesRegistry.updateFile(fileId, { backupUri });
    } catch {
      // best-effort autosave; swallow to avoid breaking the edit flow
    }
  }

  private getOrAssignBackupFileId(fileId: string): string {
    const existing = this.backupFileIdByFileId.get(fileId);
    if (existing) {
      return existing;
    }
    const file = this.filesRegistry.getFile(fileId);
    if (file) {
      const stableId = stableBackupIdForUri(file.uri);
      this.backupFileIdByFileId.set(fileId, stableId);
      return stableId;
    }
    this.backupFileIdByFileId.set(fileId, fileId);
    return fileId;
  }

  private clearAutosave(fileId: string): void {
    const state = this.autosaveStates.get(fileId);
    if (!state) {
      return;
    }
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
    }
    if (state.maxIntervalTimer !== null) {
      clearTimeout(state.maxIntervalTimer);
    }
    this.autosaveStates.delete(fileId);
  }

  private syncBackups(files: FileEntity[]): void {
    const presentIds = new Set(files.map((f) => f.fileId));
    for (const fileId of [...this.autosaveStates.keys()]) {
      if (!presentIds.has(fileId)) {
        this.clearAutosave(fileId);
        const backupFileId = this.backupFileIdByFileId.get(fileId) ?? fileId;
        this.backupFileIdByFileId.delete(fileId);
        void this.bridge.purgeBackups(backupFileId);
      }
    }
    for (const file of files) {
      if (!file.dirtyVsDisk && file.backupUri && !file.hasRecoveredBackup) {
        this.filesRegistry.updateFile(file.fileId, { backupUri: undefined });
        this.clearAutosave(file.fileId);
        const backupFileId =
          this.backupFileIdByFileId.get(file.fileId) ?? file.fileId;
        this.backupFileIdByFileId.delete(file.fileId);
        void this.bridge.purgeBackups(backupFileId);
      }
    }
  }

  private syncWatchers(files: FileEntity[]): void {
    const presentIds = new Set(files.map((f) => f.fileId));
    for (const fileId of [...this.watcherSubs.keys()]) {
      if (!presentIds.has(fileId)) {
        this.unsubscribeWatcher(fileId);
      }
    }
    for (const file of files) {
      if (this.watcherSubs.has(file.fileId) || this.watcherSubsPending.has(file.fileId)) {
        continue;
      }
      if (!file.uri.startsWith("file:")) {
        continue;
      }
      this.subscribeWatcher(file.fileId, file.uri);
    }
  }

  private subscribeWatcher(fileId: string, uri: string): void {
    const pending = this.fileWatcher
      .watch(uri, {}, (event) => this.onWatcherEvent(fileId, event))
      .then((sub) => {
        this.watcherSubsPending.delete(fileId);
        if (!this.filesRegistry.getFile(fileId)) {
          void sub.unsubscribe();
          return;
        }
        this.watcherSubs.set(fileId, sub);
      })
      .catch(() => {
        this.watcherSubsPending.delete(fileId);
      });
    this.watcherSubsPending.set(fileId, pending);
  }

  private unsubscribeWatcher(fileId: string): void {
    const sub = this.watcherSubs.get(fileId);
    if (sub) {
      this.watcherSubs.delete(fileId);
      void sub.unsubscribe();
    }
  }

  private onWatcherEvent(fileId: string, event: FileWatcherEvent): void {
    const file = this.filesRegistry.getFile(fileId);
    if (!file) {
      return;
    }

    const isActive = this.isActiveFile(fileId);

    if (event.type === "delete") {
      const next = this.filesRegistry.updateFile(fileId, {
        diskState: "deletedOnDisk"
      });
      if (isActive && next && !this.externalPromptInFlight.has(fileId)) {
        this.externalPromptInFlight.add(fileId);
        void this.handleDeletedFile(next).finally(() => {
          this.externalPromptInFlight.delete(fileId);
        });
      }
      return;
    }

    const isDirty = this.isLocallyDirty(file);
    if (isActive && !isDirty) {
      void this.fileMediator.reloadFile(fileId);
      return;
    }
    const next = this.filesRegistry.updateFile(fileId, {
      diskState: "modifiedOnDisk"
    });
    if (!next) {
      return;
    }
    if (isActive && isDirty && !this.externalPromptInFlight.has(fileId)) {
      this.externalPromptInFlight.add(fileId);
      void this.handleExternallyModifiedDirtyFile(next).finally(() => {
        this.externalPromptInFlight.delete(fileId);
      });
      return;
    }
    if (!isActive && isDirty) {
      this.scheduleExternalDirtyPromptRetry(fileId);
    }
  }

  private scheduleExternalDirtyPromptRetry(fileId: string): void {
    const existing = this.externalPromptRetryTimers.get(fileId);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      this.externalPromptRetryTimers.delete(fileId);
      const file = this.filesRegistry.getFile(fileId);
      if (!file) {
        return;
      }
      if (file.diskState !== "modifiedOnDisk") {
        return;
      }
      if (!this.isLocallyDirty(file)) {
        return;
      }
      if (!this.isActiveFile(fileId)) {
        return;
      }
      if (this.externalPromptInFlight.has(fileId)) {
        return;
      }
      this.externalPromptInFlight.add(fileId);
      void this.handleExternallyModifiedDirtyFile(file).finally(() => {
        this.externalPromptInFlight.delete(fileId);
      });
    }, 75);
    this.externalPromptRetryTimers.set(fileId, timer);
  }

  private recordDirtyTransitions(files: FileEntity[]): void {
    const now = Date.now();
    for (const file of files) {
      if (file.dirtyVsDisk) {
        if (!this.lastDirtyAtByFileId.has(file.fileId)) {
          this.lastDirtyAtByFileId.set(file.fileId, now);
        }
      } else {
        this.lastDirtyAtByFileId.delete(file.fileId);
      }
    }
  }

  private isLocallyDirty(file: FileEntity): boolean {
    if (file.dirtyVsDisk) {
      return true;
    }
    const lastDirtyAt = this.lastDirtyAtByFileId.get(file.fileId);
    if (lastDirtyAt === undefined) {
      return false;
    }
    return Date.now() - lastDirtyAt < 1_500;
  }

  private isActiveFile(fileId: string): boolean {
    const snapshotActiveFileId = this.activeFileSnapshotProvider?.() ?? null;
    const mediatorActiveFileId = this.fileMediator.getActiveFileId();
    const textRegistry = getTextEditorRegistry() as unknown as {
      getActiveFile?: () => { fileId?: string } | null;
    };
    const textEditorActiveFileId = textRegistry.getActiveFile?.()?.fileId ?? null;
    return (
      snapshotActiveFileId === fileId ||
      mediatorActiveFileId === fileId ||
      this.activeFileId === fileId ||
      textEditorActiveFileId === fileId
    );
  }

  private scheduleSave(): void {
    if (!this.hydrated) {
      return;
    }
    if (this.pushTimer !== null) {
      clearTimeout(this.pushTimer);
    }
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      void this.pushSnapshot();
    }, this.debounceMs);
  }

  private async pushSnapshot(): Promise<void> {
    const files: PersistedFileEntry[] = this.filesRegistry
      .listFiles()
      .map((file) => ({
        uri: file.uri,
        mimeType: file.mimeType,
        editorId: file.editorId,
        engineBinding: file.engineBinding,
        backupFileId: this.backupFileIdByFileId.get(file.fileId),
        persistentViewState: file.persistentViewState
      }));

    let activeFileUri: string | undefined;
    if (this.activeFileId) {
      activeFileUri = this.filesRegistry.getFile(this.activeFileId)?.uri;
    }

    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: this.now().toISOString(),
      activeFileUri,
      files,
      layout: this.layout ?? undefined
    };
    await this.bridge.saveWorkspace(snapshot);
  }
}

function hasMeaningfulContent(text: string | null): boolean {
  return text != null && text.trim().length > 0;
}
