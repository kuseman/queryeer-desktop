import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileRegistry } from "../../core/plugin-runtime/FileRegistry";
import { createFileMediator } from "../../core/plugin-runtime/FileMediator";
import type {
  FileWatcherEvent,
  FileWatcherEventHandler,
  FileWatcherService,
  FileWatcherSubscription
} from "../../contracts/files/FileWatcher";
import {
  emptyWorkspaceSnapshot,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceSnapshot
} from "../../contracts/workspace/WorkspaceSnapshot";
import {
  RendererWorkspaceService,
  type WorkspaceBridge
} from "./workspace-service";

type WatcherHarness = {
  service: FileWatcherService;
  fire: (uri: string, event: FileWatcherEvent) => void;
  watchMock: ReturnType<typeof vi.fn>;
  unsubscribeMock: ReturnType<typeof vi.fn>;
};

function createWatcherHarness(): WatcherHarness {
  let counter = 0;
  const handlersByUri = new Map<string, Set<FileWatcherEventHandler>>();
  const unsubscribeMock = vi.fn();
  const watchMock = vi.fn(
    async (uri: string, _opts: unknown, handler: FileWatcherEventHandler) => {
      counter += 1;
      const subscriptionId = `sub-${counter}`;
      const set = handlersByUri.get(uri) ?? new Set<FileWatcherEventHandler>();
      set.add(handler);
      handlersByUri.set(uri, set);
      const sub: FileWatcherSubscription = {
        subscriptionId,
        unsubscribe: async () => {
          unsubscribeMock(subscriptionId);
          set.delete(handler);
          if (set.size === 0) {
            handlersByUri.delete(uri);
          }
        }
      };
      return sub;
    }
  );
  const service: FileWatcherService = {
    watch: watchMock as unknown as FileWatcherService["watch"],
    mutePath: vi.fn(async () => {})
  };
  return {
    service,
    watchMock,
    unsubscribeMock,
    fire: (uri, event) => {
      for (const handler of handlersByUri.get(uri) ?? []) {
        handler(event);
      }
    }
  };
}

function makeHarness(
  initialSnapshot: WorkspaceSnapshot = emptyWorkspaceSnapshot(),
  overrides: { backupDebounceMs?: number; backupMaxIntervalMs?: number } = {}
) {
  const fileRegistryImpl = new FileRegistry();
  const filesRegistry = fileRegistryImpl.createFilesRegistry();
  const backupMock = vi.fn<WorkspaceBridge["saveBackup"]>(async () => ({
    backupUri: "file:///backup.bak"
  }));
  const purgeMock = vi.fn<WorkspaceBridge["purgeBackups"]>(async () => ({ purged: 0 }));
  const listBackupsMock = vi.fn<WorkspaceBridge["listBackups"]>(async () => ({
    backupPaths: []
  }));
  const readLatestBackupMock = vi.fn<WorkspaceBridge["readLatestBackup"]>(
    async () => null
  );
  const onFileChangedListeners = new Set<(file: unknown, text: string) => void>();
  const mediator = createFileMediator({
    filesRegistry,
    executeBackendQuery: async (params) => ({
      accepted: true,
      queryExecutionId: params.queryExecutionId
    }),
    changeDebounceMs: 10,
    onFileChanged: (file, text) => {
      for (const listener of onFileChangedListeners) {
        listener(file, text);
      }
    }
  });
  const reloadSpy = vi.spyOn(mediator, "reloadFile");
  const saveMock = vi.fn<WorkspaceBridge["saveWorkspace"]>(async () => ({ accepted: true }));
  const bridge: WorkspaceBridge = {
    getWorkspace: async () => initialSnapshot,
    saveWorkspace: saveMock,
    saveBackup: backupMock,
    purgeBackups: purgeMock,
    listBackups: listBackupsMock,
    readLatestBackup: readLatestBackupMock
  };
  const watcher = createWatcherHarness();
  const service = new RendererWorkspaceService({
    bridge,
    filesRegistry,
    fileMediator: mediator,
    fileWatcher: watcher.service,
    debounceMs: 25,
    backupDebounceMs: overrides.backupDebounceMs ?? 100,
    backupMaxIntervalMs: overrides.backupMaxIntervalMs ?? 1_000
  });
  onFileChangedListeners.add((file, text) => {
    service.handleFileChanged(file as never, text);
  });
  return {
    service,
    filesRegistry,
    mediator,
    reloadSpy,
    saveMock,
    backupMock,
    purgeMock,
    listBackupsMock,
    readLatestBackupMock,
    watcher,
    fileRegistryImpl
  };
}

describe("RendererWorkspaceService.hydrate", () => {
  it("opens each persisted file via the mediator and restores active fileId", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      activeFileUri: "file:///b.txt",
      files: [
        { uri: "file:///a.txt", mimeType: "text/plain" },
        { uri: "file:///b.txt", mimeType: "text/plain" }
      ]
    };
    const { service, filesRegistry } = makeHarness(snapshot);

    await service.hydrate();

    const open = filesRegistry.listFiles();
    expect(open).toHaveLength(2);
    expect(service.hasRestoredFiles()).toBe(true);
    const activeFileId = service.restoredActiveFileId();
    expect(activeFileId).not.toBeNull();
    expect(filesRegistry.getFile(activeFileId!)?.uri).toBe("file:///b.txt");
  });

  it("hasRestoredFiles is false when no files persisted", async () => {
    const { service } = makeHarness();
    await service.hydrate();
    expect(service.hasRestoredFiles()).toBe(false);
  });
});

describe("RendererWorkspaceService snapshot push", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces snapshot pushes triggered by registry changes", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();

    await mediator.openFile("file:///c.txt", { mimeType: "text/plain" });
    await mediator.openFile("file:///d.txt", { mimeType: "text/plain" });

    await vi.advanceTimersByTimeAsync(50);

    expect(saveMock).toHaveBeenCalledTimes(1);
    const persisted = saveMock.mock.calls[0]![0];
    expect(persisted.files.map((f) => f.uri)).toEqual(["file:///c.txt", "file:///d.txt"]);
  });

  it("flush bypasses the debounce timer", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();

    await mediator.openFile("file:///e.txt", { mimeType: "text/plain" });
    await service.flush();

    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  it("excludes untitled files from the persisted snapshot", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();

    await mediator.openFile("untitled:scratch", { mimeType: "text/plain" });
    await service.flush();

    const persisted = saveMock.mock.calls[0]?.[0];
    expect(persisted?.files ?? []).toEqual([]);
  });

  it("setActiveFileId triggers a debounced save", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///x.txt", { mimeType: "text/plain" });
    saveMock.mockClear();

    service.setActiveFileId(file.fileId);
    await vi.advanceTimersByTimeAsync(50);

    expect(saveMock).toHaveBeenCalledTimes(1);
    const persisted = saveMock.mock.calls[0]![0];
    expect(persisted.activeFileUri).toBe("file:///x.txt");
  });
});

describe("RendererWorkspaceService layout state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null restored layout when none persisted", async () => {
    const { service } = makeHarness();
    await service.hydrate();
    expect(service.restoredLayout()).toBeNull();
  });

  it("exposes restored layout from hydrated snapshot", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [],
      layout: {
        visibleZones: ["menuBar", "mainArea", "statusBar"],
        sidebarWidths: { primary: 320, secondary: 200 }
      }
    };
    const { service } = makeHarness(snapshot);
    await service.hydrate();
    expect(service.restoredLayout()).toEqual(snapshot.layout);
  });

  it("setLayout includes layout in the persisted snapshot", async () => {
    const { service, saveMock } = makeHarness();
    await service.hydrate();
    saveMock.mockClear();

    service.setLayout({
      visibleZones: ["mainArea", "statusBar", "primarySidebar"],
      sidebarWidths: { primary: 250 }
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(saveMock).toHaveBeenCalledTimes(1);
    const persisted = saveMock.mock.calls[0]![0];
    expect(persisted.layout?.visibleZones).toEqual([
      "mainArea",
      "statusBar",
      "primarySidebar"
    ]);
    expect(persisted.layout?.sidebarWidths?.primary).toBe(250);
  });
});

describe("RendererWorkspaceService fileWatcher integration", () => {
  const diskEvent: FileWatcherEvent = {
    type: "modify",
    uri: "file:///a.txt",
    timestamp: "t"
  };

  async function flushMicrotasks(): Promise<void> {
    // Allow pending watchMock.then() continuations to run.
    await Promise.resolve();
    await Promise.resolve();
  }

  it("subscribes a watcher for each restored disk-URI file", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        { uri: "file:///a.txt", mimeType: "text/plain" },
        { uri: "file:///b.txt", mimeType: "text/plain" }
      ]
    };
    const { service, watcher } = makeHarness(snapshot);

    await service.hydrate();
    await flushMicrotasks();

    expect(watcher.watchMock).toHaveBeenCalledTimes(2);
    expect(watcher.watchMock.mock.calls.map((c) => c[0])).toEqual([
      "file:///a.txt",
      "file:///b.txt"
    ]);
  });

  it("does not subscribe a watcher for untitled files", async () => {
    const { service, mediator, watcher } = makeHarness();
    await service.hydrate();

    await mediator.openFile("untitled:scratch", { mimeType: "text/plain" });
    await flushMicrotasks();

    expect(watcher.watchMock).not.toHaveBeenCalled();
  });

  it("unsubscribes the watcher when a file closes", async () => {
    const { service, mediator, watcher } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    await flushMicrotasks();

    await mediator.closeFile(file.fileId, { discardDirty: true });
    await flushMicrotasks();

    expect(watcher.unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("silently reloads when the active file is clean on external change", async () => {
    const { service, mediator, watcher, reloadSpy, filesRegistry } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    service.setActiveFileId(file.fileId);
    await flushMicrotasks();

    watcher.fire("file:///a.txt", diskEvent);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy).toHaveBeenCalledWith(file.fileId);
    expect(filesRegistry.getFile(file.fileId)?.externallyModified).toBeFalsy();
  });

  it("sets externallyModified on active + dirty file (no auto reload)", async () => {
    const { service, mediator, watcher, reloadSpy, filesRegistry, fileRegistryImpl } =
      makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    service.setActiveFileId(file.fileId);
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });
    await flushMicrotasks();

    watcher.fire("file:///a.txt", diskEvent);

    expect(reloadSpy).not.toHaveBeenCalled();
    const after = filesRegistry.getFile(file.fileId)!;
    expect(after.externallyModified).toBe(true);
    expect(after.reloadPending).toBe(false);
  });

  it("sets externallyModified + reloadPending on non-active + clean file", async () => {
    const { service, mediator, watcher, reloadSpy, filesRegistry } = makeHarness();
    await service.hydrate();
    const active = await mediator.openFile("file:///active.txt", { mimeType: "text/plain" });
    const other = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    service.setActiveFileId(active.fileId);
    await flushMicrotasks();

    watcher.fire("file:///a.txt", diskEvent);

    expect(reloadSpy).not.toHaveBeenCalled();
    const after = filesRegistry.getFile(other.fileId)!;
    expect(after.externallyModified).toBe(true);
    expect(after.reloadPending).toBe(true);
  });

  it("sets only externallyModified on non-active + dirty file (no reloadPending)", async () => {
    const { service, mediator, watcher, filesRegistry, fileRegistryImpl } = makeHarness();
    await service.hydrate();
    const active = await mediator.openFile("file:///active.txt", { mimeType: "text/plain" });
    const other = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    service.setActiveFileId(active.fileId);
    fileRegistryImpl.createFilesRegistry().updateFile(other.fileId, { dirtyVsDisk: true });
    await flushMicrotasks();

    watcher.fire("file:///a.txt", diskEvent);

    const after = filesRegistry.getFile(other.fileId)!;
    expect(after.externallyModified).toBe(true);
    expect(after.reloadPending).toBe(false);
  });

  it("auto-reloads on setActiveFileId when the new active file has reloadPending", async () => {
    const { service, mediator, reloadSpy, fileRegistryImpl } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///r.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      reloadPending: true
    });
    reloadSpy.mockClear();

    service.setActiveFileId(file.fileId);

    expect(reloadSpy).toHaveBeenCalledWith(file.fileId);
  });
});

describe("RendererWorkspaceService autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires a backup after the edit-debounce window", async () => {
    const { service, mediator, backupMock, fileRegistryImpl } = makeHarness(
      undefined,
      { backupDebounceMs: 100, backupMaxIntervalMs: 5_000 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });

    mediator.notifyChanged(file.fileId, "edited");
    await vi.advanceTimersByTimeAsync(150);

    expect(backupMock).toHaveBeenCalledTimes(1);
    expect(backupMock).toHaveBeenCalledWith(file.fileId, "edited");
  });

  it("coalesces rapid edits inside the debounce window into one backup", async () => {
    const { service, mediator, backupMock, fileRegistryImpl } = makeHarness(
      undefined,
      { backupDebounceMs: 100, backupMaxIntervalMs: 5_000 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });

    mediator.notifyChanged(file.fileId, "v1");
    await vi.advanceTimersByTimeAsync(50);
    mediator.notifyChanged(file.fileId, "v2");
    await vi.advanceTimersByTimeAsync(50);
    mediator.notifyChanged(file.fileId, "v3");
    await vi.advanceTimersByTimeAsync(150);

    expect(backupMock).toHaveBeenCalledTimes(1);
    expect(backupMock).toHaveBeenCalledWith(file.fileId, "v3");
  });

  it("fires a backup on the max-interval even when edits keep resetting the debounce", async () => {
    const { service, mediator, backupMock, fileRegistryImpl } = makeHarness(
      undefined,
      { backupDebounceMs: 500, backupMaxIntervalMs: 200 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });

    for (let i = 0; i < 5; i++) {
      mediator.notifyChanged(file.fileId, `v${i}`);
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(backupMock).toHaveBeenCalledTimes(1);
  });

  it("purges backups when a file transitions dirty→clean", async () => {
    const { service, filesRegistry, mediator, purgeMock, fileRegistryImpl } = makeHarness(
      undefined,
      { backupDebounceMs: 50, backupMaxIntervalMs: 5_000 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      dirtyVsDisk: true,
      backupUri: "file:///backup.bak"
    });

    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: false });
    await vi.advanceTimersByTimeAsync(10);

    expect(purgeMock).toHaveBeenCalledWith(file.fileId);
    expect(filesRegistry.getFile(file.fileId)?.backupUri).toBeUndefined();
  });

  it("purges backups when a file is closed", async () => {
    const { service, mediator, purgeMock } = makeHarness(undefined, {
      backupDebounceMs: 50,
      backupMaxIntervalMs: 5_000
    });
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    mediator.notifyChanged(file.fileId, "edited");
    purgeMock.mockClear();

    await mediator.closeFile(file.fileId, { discardDirty: true });
    await vi.advanceTimersByTimeAsync(10);

    expect(purgeMock).toHaveBeenCalledWith(file.fileId);
  });

  it("updates FileEntity.backupUri after a backup write", async () => {
    const { service, filesRegistry, mediator, fileRegistryImpl } = makeHarness(
      undefined,
      { backupDebounceMs: 50, backupMaxIntervalMs: 5_000 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });

    mediator.notifyChanged(file.fileId, "edited");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(filesRegistry.getFile(file.fileId)?.backupUri).toBe("file:///backup.bak");
  });
});

describe("RendererWorkspaceService crash recovery", () => {
  it("persists backupFileId in the snapshot when a backup is written", async () => {
    vi.useFakeTimers();
    try {
      const { service, mediator, saveMock, fileRegistryImpl } = makeHarness(
        undefined,
        { backupDebounceMs: 50, backupMaxIntervalMs: 5_000 }
      );
      await service.hydrate();
      const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
      fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });
      mediator.notifyChanged(file.fileId, "edited");
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      saveMock.mockClear();

      await service.flush();

      const persisted = saveMock.mock.calls[0]![0];
      expect(persisted.files[0]!.backupFileId).toBe(file.fileId);
    } finally {
      vi.useRealTimers();
    }
  });

  it("detects a surviving backup on hydrate and marks the entity", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        {
          uri: "file:///recover.txt",
          mimeType: "text/plain",
          backupFileId: "previous-session-fid"
        }
      ]
    };
    const { service, filesRegistry, readLatestBackupMock } = makeHarness(snapshot);
    readLatestBackupMock.mockResolvedValueOnce({
      text: "recovered content",
      savedAt: "t2",
      backupUri: "file:///backup/previous.bak"
    });

    await service.hydrate();

    const entities = filesRegistry.listFiles();
    expect(entities).toHaveLength(1);
    const entity = entities[0]!;
    expect(entity.hasRecoveredBackup).toBe(true);
    expect(entity.backupUri).toBe("file:///backup/previous.bak");
  });

  it("does not mark hasRecoveredBackup when no surviving backup exists", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        {
          uri: "file:///nothing.txt",
          mimeType: "text/plain",
          backupFileId: "stale-fid"
        }
      ]
    };
    const { service, filesRegistry } = makeHarness(snapshot);
    // readLatestBackupMock defaults to null

    await service.hydrate();

    const entity = filesRegistry.listFiles()[0]!;
    expect(entity.hasRecoveredBackup).toBeFalsy();
    expect(entity.backupUri).toBeUndefined();
  });

  it("listPendingRestores returns recovered entries", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        { uri: "file:///r.txt", mimeType: "text/plain", backupFileId: "prev-1" },
        { uri: "file:///clean.txt", mimeType: "text/plain" }
      ]
    };
    const { service, readLatestBackupMock } = makeHarness(snapshot);
    readLatestBackupMock.mockResolvedValueOnce({
      text: "x",
      savedAt: "t",
      backupUri: "file:///backup/prev.bak"
    });

    await service.hydrate();
    const pending = service.listPendingRestores();

    expect(pending).toHaveLength(1);
    expect(pending[0]!.uri).toBe("file:///r.txt");
    expect(pending[0]!.backupFileId).toBe("prev-1");
  });

  it("discardBackup purges and clears the flag", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        { uri: "file:///r.txt", mimeType: "text/plain", backupFileId: "prev-1" }
      ]
    };
    const { service, filesRegistry, purgeMock, readLatestBackupMock } =
      makeHarness(snapshot);
    readLatestBackupMock.mockResolvedValueOnce({
      text: "x",
      savedAt: "t",
      backupUri: "file:///backup/prev.bak"
    });
    await service.hydrate();
    const fileId = filesRegistry.listFiles()[0]!.fileId;

    await service.discardBackup(fileId);

    expect(purgeMock).toHaveBeenCalledWith("prev-1");
    const after = filesRegistry.getFile(fileId);
    expect(after?.hasRecoveredBackup).toBe(false);
    expect(after?.backupUri).toBeUndefined();
    expect(service.listPendingRestores()).toHaveLength(0);
  });

  it("readBackup resolves against the linked backupFileId", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        { uri: "file:///r.txt", mimeType: "text/plain", backupFileId: "prev-1" }
      ]
    };
    const { service, filesRegistry, readLatestBackupMock } = makeHarness(snapshot);
    readLatestBackupMock.mockResolvedValueOnce({
      text: "content",
      savedAt: "t",
      backupUri: "file:///backup/prev.bak"
    });
    await service.hydrate();
    const fileId = filesRegistry.listFiles()[0]!.fileId;
    readLatestBackupMock.mockResolvedValueOnce({
      text: "restored-text",
      savedAt: "t2",
      backupUri: "file:///backup/prev.bak"
    });

    const result = await service.readBackup(fileId);

    expect(result?.text).toBe("restored-text");
    expect(readLatestBackupMock).toHaveBeenLastCalledWith("prev-1");
  });
});
