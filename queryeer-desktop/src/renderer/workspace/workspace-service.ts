import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type {
  FileWatcherService,
  FileWatcherSubscription
} from "../../contracts/files/FileWatcher";
import {
  WORKSPACE_SCHEMA_VERSION,
  type PersistedFileEntry,
  type PersistedLayoutSnapshot,
  type WorkspaceSnapshot
} from "../../contracts/workspace/WorkspaceSnapshot";

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

export class RendererWorkspaceService {
  private readonly bridge: WorkspaceBridge;
  private readonly filesRegistry: FilesRegistry;
  private readonly fileMediator: FileMediator;
  private readonly fileWatcher: FileWatcherService;
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

  public constructor(options: RendererWorkspaceServiceOptions) {
    this.bridge = options.bridge;
    this.filesRegistry = options.filesRegistry;
    this.fileMediator = options.fileMediator;
    this.fileWatcher = options.fileWatcher;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.backupDebounceMs = options.backupDebounceMs ?? DEFAULT_BACKUP_DEBOUNCE_MS;
    this.backupMaxIntervalMs = options.backupMaxIntervalMs ?? DEFAULT_BACKUP_MAX_INTERVAL_MS;
    this.now = options.now ?? (() => new Date());
  }

  public async hydrate(): Promise<void> {
    const snapshot = await this.bridge.getWorkspace();
    for (const entry of snapshot.files) {
      const entity = await this.fileMediator.openFile(entry.uri, {
        mimeType: entry.mimeType,
        editorId: entry.editorId,
        engineBinding: entry.engineBinding
      });
      if (entry.backupFileId) {
        this.backupFileIdByFileId.set(entity.fileId, entry.backupFileId);
        await this.detectRecoveredBackup(entity.fileId, entry.backupFileId);
      }
    }
    if (snapshot.activeFileUri) {
      const entity = this.filesRegistry
        .listFiles()
        .find((f) => f.uri === snapshot.activeFileUri);
      if (entity) {
        this.activeFileId = entity.fileId;
      }
    }
    this.restoredLayoutSnapshot = snapshot.layout ?? null;
    this.layout = snapshot.layout ?? null;

    this.hydrated = true;
    this.unsubscribeFromFiles = this.filesRegistry.subscribe((files) => {
      this.scheduleSave();
      this.syncWatchers(files);
      this.syncBackups(files);
    });
  }

  private async detectRecoveredBackup(
    fileId: string,
    backupFileId: string
  ): Promise<void> {
    try {
      const latest = await this.bridge.readLatestBackup(backupFileId);
      if (!latest) {
        return;
      }
      this.filesRegistry.updateFile(fileId, {
        hasRecoveredBackup: true,
        backupUri: latest.backupUri
      });
    } catch {
      // best-effort; missing dir or read failure means no recovery offered
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

  public setActiveFileId(fileId: string | null): void {
    if (this.activeFileId === fileId) {
      return;
    }
    this.activeFileId = fileId;
    if (!this.hydrated) {
      return;
    }
    this.scheduleSave();
    if (fileId) {
      const file = this.filesRegistry.getFile(fileId);
      if (file?.reloadPending && !file.dirtyVsDisk) {
        void this.fileMediator.reloadFile(fileId);
      }
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
    if (!file || !file.dirtyVsDisk) {
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
      .watch(uri, {}, () => this.onWatcherEvent(fileId))
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

  private onWatcherEvent(fileId: string): void {
    const file = this.filesRegistry.getFile(fileId);
    if (!file) {
      return;
    }
    const isActive = this.activeFileId === fileId;
    if (isActive && !file.dirtyVsDisk) {
      void this.fileMediator.reloadFile(fileId);
      return;
    }
    this.filesRegistry.updateFile(fileId, {
      externallyModified: true,
      reloadPending: !isActive && !file.dirtyVsDisk
    });
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
      .filter(isPersistableEntity)
      .map((file) => ({
        uri: file.uri,
        mimeType: file.mimeType,
        editorId: file.editorId,
        engineBinding: file.engineBinding,
        backupFileId: this.backupFileIdByFileId.get(file.fileId)
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

function isPersistableEntity(file: FileEntity): boolean {
  return !file.uri.startsWith("untitled:");
}
