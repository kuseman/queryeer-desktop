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
  type RendererWorkspaceServiceOptions,
  type WorkspaceBridge
} from "./workspace-service";

const applyRecoveredContentMock = vi.fn();

beforeEach(() => {
  applyRecoveredContentMock.mockReset();
});

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

  filesRegistry.capabilities.registerContentCategory("text/plain", "text");
  filesRegistry.capabilities.registerCapabilities("text/plain", ["backupable", "editable", "viewable"]);

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
  const showDialogMock = vi.fn<
    RendererWorkspaceServiceOptions["showDialog"]
  >(async () => ({ action: "" }));
  const onFileChangedListeners = new Set<(file: unknown, text: string) => void>();
  const mediator = createFileMediator({
    filesRegistry,
    changeDebounceMs: 10,
    onFileChanged: (file, text) => {
      for (const listener of onFileChangedListeners) {
        listener(file, text);
      }
    }
  });
  const setUntitledCounterSpy = vi.spyOn(mediator, "setUntitledCounter");
  const getUntitledCounterSpy = vi.spyOn(mediator, "getUntitledCounter");
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
  const editorRegistryHost = {
    getActiveEditor: () => null,
    onActiveEditorChanged: () => ({ dispose: () => {} }),
    setActiveEditor: () => {},
    registerContentRepository: () => () => {},
    resolveFileContent: () => undefined,
    broadcastContentUpdate: () => {},
    applyRecoveredContent: applyRecoveredContentMock,
    onContentDirty: () => () => {}
  };

  const service = new RendererWorkspaceService({
    bridge,
    filesRegistry,
    fileMediator: mediator,
    fileWatcher: watcher.service,
    showDialog: showDialogMock,
    editorRegistryHost,
    debounceMs: 25,
    backupDebounceMs: overrides.backupDebounceMs ?? 100,
    backupMaxIntervalMs: overrides.backupMaxIntervalMs ?? 1_000,
    applyRecoveredContent: applyRecoveredContentMock
  });
  onFileChangedListeners.add((file, text) => {
    service.handleFileChanged(file as never, text);
  });
  return {
    service,
    filesRegistry,
    mediator,
    setUntitledCounterSpy,
    getUntitledCounterSpy,
    reloadSpy,
    saveMock,
    backupMock,
    purgeMock,
    listBackupsMock,
    readLatestBackupMock,
    watcher,
    fileRegistryImpl,
    showDialogMock
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

  it("restores untitled counter from snapshot", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: []
    };
    const { service, setUntitledCounterSpy, mediator } = makeHarness(snapshot);

    await service.hydrate();

    expect(setUntitledCounterSpy).toHaveBeenCalledWith(0);
    expect(mediator.getUntitledCounter()).toBe(0);
  });

  it("derives untitled counter from existing untitled files", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        { uri: "untitled:Untitled11.sql", mimeType: "application/sql" }
      ]
    };
    const { service, mediator } = makeHarness(snapshot);

    await service.hydrate();

    expect(mediator.getUntitledCounter()).toBe(11);
  });

  it("hasRestoredFiles is false when no files persisted", async () => {
    const { service } = makeHarness();
    await service.hydrate();
    expect(service.hasRestoredFiles()).toBe(false);
  });
});

describe("RendererWorkspaceService snapshots", () => {
  it("does not persist workspace-transient files", async () => {
    const { service, mediator, filesRegistry, saveMock } = makeHarness();

    await service.hydrate();
    const persisted = await mediator.createUntitledFile({ mimeType: "text/plain", extension: "txt" });
    const transient = await mediator.createUntitledFile({ mimeType: "text/plain", extension: "txt" });
    filesRegistry.updateFile(transient.fileId, {
      metadata: { workspaceTransient: true }
    });
    service.setActiveFileId(transient.fileId);

    await service.flush();

    const snapshot = saveMock.mock.calls.at(-1)?.[0];
    expect(snapshot?.files.map((file) => file.uri)).toEqual([persisted.uri]);
    expect(snapshot?.activeFileUri).toBeUndefined();
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

  it("does not persist untitled counter in workspace snapshot", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();
    mediator.setUntitledCounter(9);

    await service.flush();

    expect(saveMock).toHaveBeenCalledTimes(1);
    const persisted = saveMock.mock.calls[0]?.[0];
    expect(persisted).not.toHaveProperty("untitledCounter");
  });

it("persists untitled files in the snapshot", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();

    await mediator.openFile("untitled:scratch", { mimeType: "text/plain" });
    await service.flush();

    const persisted = saveMock.mock.calls[0]?.[0];
    expect(persisted?.files).toHaveLength(1);
    expect(persisted?.files[0]?.uri).toBe("untitled:scratch");
  });

  it("round-trips Monaco persistent view state across simulated restart", async () => {
    const monacoState = {
      cursorState: [{ inSelectionMode: false, position: { lineNumber: 12, column: 7 } }],
      viewState: { scrollTop: 240, scrollLeft: 16 }
    };

    const { service, mediator, filesRegistry, saveMock } = makeHarness();
    await service.hydrate();

    const file = await mediator.openFile("file:///persisted.sql", { mimeType: "application/sql" });
    filesRegistry.updateFile(file.fileId, {
      persistentViewState: { "monaco.editor": monacoState }
    });
    await service.flush();

    const firstPersisted = saveMock.mock.calls[0]?.[0];
    expect(firstPersisted?.files[0]?.persistentViewState?.["monaco.editor"]).toEqual(monacoState);

    const simulatedWorkspaceJson = JSON.parse(JSON.stringify(firstPersisted)) as WorkspaceSnapshot;
    const restart = makeHarness(simulatedWorkspaceJson);
    await restart.service.hydrate();

    const reopened = restart.filesRegistry.listFiles().find((f) => f.uri === "file:///persisted.sql");
    expect(reopened?.persistentViewState?.["monaco.editor"]).toEqual(monacoState);

    await restart.service.flush();
    const secondPersisted = restart.saveMock.mock.calls[0]?.[0];
    expect(secondPersisted?.files[0]?.persistentViewState?.["monaco.editor"]).toEqual(monacoState);
  });
});

describe("RendererWorkspaceService untitled file persistence", () => {
  it("restores untitled file content from backup on hydrate", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        { uri: "untitled:scratch", mimeType: "text/plain", backupFileId: "untitled-fid" }
      ]
    };
    const { service, filesRegistry, readLatestBackupMock } = makeHarness(snapshot);
    readLatestBackupMock.mockResolvedValueOnce({
      text: "untitled content here",
      savedAt: "t2",
      backupUri: "file:///backup/untitled.bak"
    });

    await service.hydrate();

    const entity = filesRegistry.listFiles()[0]!;
    expect(entity.uri).toBe("untitled:scratch");
    expect(entity.dirtyVsDisk).toBe(true);
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

  it("restores and persists panelHeight", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [],
      layout: {
        panelHeight: 350
      }
    };
    const { service: restoreService } = makeHarness(snapshot);
    await restoreService.hydrate();
    expect(restoreService.restoredLayout()?.panelHeight).toBe(350);

    const { service, saveMock } = makeHarness();
    await service.hydrate();
    saveMock.mockClear();

    service.setLayout({
      visibleZones: ["mainArea", "statusBar"],
      panelHeight: 400
    });
    await vi.advanceTimersByTimeAsync(50);

    expect(saveMock).toHaveBeenCalledTimes(1);
    const persisted = saveMock.mock.calls[0]![0];
    expect(persisted.layout?.panelHeight).toBe(400);
  });

  it("reorders persisted files via setOpenFileOrder", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();

    const fileA = await mediator.openFile("file:///a.sql", { mimeType: "application/sql" });
    const fileB = await mediator.openFile("file:///b.sql", { mimeType: "application/sql" });
    saveMock.mockClear();

    service.setOpenFileOrder([fileB.uri, fileA.uri]);
    service.setLayout({ visibleZones: ["mainArea", "statusBar"] });
    await vi.advanceTimersByTimeAsync(50);

    expect(saveMock).toHaveBeenCalledTimes(1);
    const persisted = saveMock.mock.calls[0]![0];
    expect(persisted.files.map((f: { uri: string }) => f.uri)).toEqual(["file:///b.sql", "file:///a.sql"]);
  });

  it("round-trips file tab order across simulated restart", async () => {
    const { service, mediator, saveMock } = makeHarness();
    await service.hydrate();

    const fileA = await mediator.openFile("file:///a.sql", { mimeType: "application/sql" });
    const fileB = await mediator.openFile("file:///b.sql", { mimeType: "application/sql" });
    const fileC = await mediator.openFile("file:///c.sql", { mimeType: "application/sql" });

    service.setOpenFileOrder([fileB.uri, fileA.uri, fileC.uri]);
    service.setLayout({ visibleZones: ["mainArea", "statusBar"] });
    await service.flush();

    const firstPersisted = saveMock.mock.calls[0]?.[0];
    expect(firstPersisted?.files.map((f: { uri: string }) => f.uri)).toEqual([
      "file:///b.sql",
      "file:///a.sql",
      "file:///c.sql"
    ]);

    const simulatedWorkspaceJson = JSON.parse(JSON.stringify(firstPersisted)) as WorkspaceSnapshot;
    const restart = makeHarness(simulatedWorkspaceJson);
    await restart.service.hydrate();

    const restoredUris = restart.filesRegistry.listFiles().map((f) => f.uri);
    expect(restoredUris).toEqual(["file:///b.sql", "file:///a.sql", "file:///c.sql"]);
  });
});

describe("RendererWorkspaceService fileWatcher integration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
    expect(filesRegistry.getFile(file.fileId)?.diskState).toBe("inSync");
  });

  it("sets modifiedOnDisk on active + dirty file (no auto reload)", async () => {
    const { service, mediator, watcher, reloadSpy, filesRegistry, fileRegistryImpl, showDialogMock } =
      makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    service.setActiveFileId(file.fileId);
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });
    await flushMicrotasks();

    watcher.fire("file:///a.txt", diskEvent);
    await vi.runAllTimersAsync();

    expect(reloadSpy).not.toHaveBeenCalled();
    const after = filesRegistry.getFile(file.fileId)!;
    expect(after.diskState).toBe("modifiedOnDisk");
    expect(showDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "File Changed",
        message: expect.stringContaining("a.txt")
      })
    );
  });

  it("sets modifiedOnDisk on non-active + clean file", async () => {
    const { service, mediator, watcher, reloadSpy, filesRegistry } = makeHarness();
    await service.hydrate();
    const active = await mediator.openFile("file:///active.txt", { mimeType: "text/plain" });
    const other = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    service.setActiveFileId(active.fileId);
    await flushMicrotasks();

    watcher.fire("file:///a.txt", diskEvent);

    expect(reloadSpy).not.toHaveBeenCalled();
    const after = filesRegistry.getFile(other.fileId)!;
    expect(after.diskState).toBe("modifiedOnDisk");
  });

  it("sets modifiedOnDisk on non-active + dirty file (no auto-reload)", async () => {
    const { service, mediator, watcher, filesRegistry, fileRegistryImpl } = makeHarness();
    await service.hydrate();
    const active = await mediator.openFile("file:///active.txt", { mimeType: "text/plain" });
    const other = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
    service.setActiveFileId(active.fileId);
    fileRegistryImpl.createFilesRegistry().updateFile(other.fileId, { dirtyVsDisk: true });
    await flushMicrotasks();

    watcher.fire("file:///a.txt", diskEvent);

    const after = filesRegistry.getFile(other.fileId)!;
    expect(after.diskState).toBe("modifiedOnDisk");
  });

  it("auto-reloads on setActiveFileId when the file is modifiedOnDisk", async () => {
    const { service, mediator, reloadSpy, fileRegistryImpl } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///r.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk"
    });
    reloadSpy.mockClear();

    service.setActiveFileId(file.fileId);

    expect(reloadSpy).toHaveBeenCalledWith(file.fileId);
  });

  it("auto-reloads on setActiveFileId when modifiedOnDisk but NOT dirty", async () => {
    const { service, mediator, reloadSpy, fileRegistryImpl, showDialogMock } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///auto.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk",
      dirtyVsDisk: false
    });
    reloadSpy.mockClear();

    service.setActiveFileId(file.fileId);

    expect(reloadSpy).toHaveBeenCalledWith(file.fileId);
    expect(showDialogMock).not.toHaveBeenCalled();
  });

  it("shows dialog on setActiveFileId when modifiedOnDisk AND dirty", async () => {
    const { service, mediator, reloadSpy, fileRegistryImpl, showDialogMock } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///dirty.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk",
      dirtyVsDisk: true
    });
    showDialogMock.mockResolvedValue({ action: "keep" });
    reloadSpy.mockClear();

    service.setActiveFileId(file.fileId);

    expect(showDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "File Changed",
        message: expect.stringContaining("dirty.txt")
      })
    );
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("shows dialog on setActiveFileId when file is deleted", async () => {
    const { service, mediator, fileRegistryImpl, showDialogMock } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///deleted.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      diskState: "deletedOnDisk"
    });
    showDialogMock.mockResolvedValue({ action: "keep" });

    service.setActiveFileId(file.fileId);

    expect(showDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "File Deleted",
        message: expect.stringContaining("deleted.txt")
      })
    );
  });

  it("reloads file when user chooses 'reload' in dirty file dialog", async () => {
    const { service, mediator, reloadSpy, fileRegistryImpl, showDialogMock } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///conflict.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk",
      dirtyVsDisk: true
    });
    showDialogMock.mockResolvedValue({ action: "reload" });
    reloadSpy.mockClear();

    service.setActiveFileId(file.fileId);
    await Promise.resolve();

    expect(reloadSpy).toHaveBeenCalledWith(file.fileId);
  });

  it("re-evaluates external dirty state when re-selecting the same tab", async () => {
    const { service, mediator, fileRegistryImpl, showDialogMock } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///same-tab.txt", { mimeType: "text/plain" });
    service.setActiveFileId(file.fileId);
    await vi.runAllTimersAsync();
    showDialogMock.mockClear();
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, {
      diskState: "modifiedOnDisk",
      dirtyVsDisk: true
    });

    service.setActiveFileId(file.fileId);

    expect(showDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "File Changed",
        message: expect.stringContaining("same-tab.txt")
      })
    );
  });

  it("retries prompt shortly when active state races watcher event", async () => {
    const { service, mediator, watcher, showDialogMock, fileRegistryImpl } = makeHarness();
    await service.hydrate();
    const file = await mediator.openFile("file:///race2.txt", { mimeType: "text/plain" });
    fileRegistryImpl.createFilesRegistry().updateFile(file.fileId, { dirtyVsDisk: true });
    showDialogMock.mockResolvedValue({ action: "keep" });

    watcher.fire("file:///race2.txt", diskEvent);
    service.setActiveFileId(file.fileId);
    await vi.advanceTimersByTimeAsync(100);

    expect(showDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "File Changed",
        message: expect.stringContaining("race2.txt")
      })
    );
  });
});

describe("RendererWorkspaceService autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.skip("fires a backup after the edit-debounce window", async () => {
    const { service, mediator, backupMock } = makeHarness(
      undefined,
      { backupDebounceMs: 100, backupMaxIntervalMs: 5_000 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });

    service.handleFileChanged(file, "edited");
    await vi.advanceTimersByTimeAsync(150);

    expect(backupMock).toHaveBeenCalledTimes(1);
    expect(backupMock.mock.calls[0]?.[0]).toMatch(/^bkp-/);
    expect(backupMock.mock.calls[0]?.[1]).toBe("edited");
  });

  it.skip("coalesces rapid edits inside the debounce window into one backup", async () => {
    const { service, mediator, backupMock } = makeHarness(
      undefined,
      { backupDebounceMs: 100, backupMaxIntervalMs: 5_000 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });

    service.handleFileChanged(file, "v1");
    await vi.advanceTimersByTimeAsync(50);
    service.handleFileChanged(file, "v2");
    await vi.advanceTimersByTimeAsync(50);
    service.handleFileChanged(file, "v3");
    await vi.advanceTimersByTimeAsync(150);

    expect(backupMock).toHaveBeenCalledTimes(1);
    expect(backupMock.mock.calls[0]?.[0]).toMatch(/^bkp-/);
    expect(backupMock.mock.calls[0]?.[1]).toBe("v3");
  });

  it.skip("fires a backup on the max-interval even when edits keep resetting the debounce", async () => {
    const { service, mediator, backupMock } = makeHarness(
      undefined,
      { backupDebounceMs: 500, backupMaxIntervalMs: 200 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });

    for (let i = 0; i < 5; i++) {
      service.handleFileChanged(file, `v${i}`);
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
    service.handleFileChanged(file, "edited");
    purgeMock.mockClear();

    await mediator.closeFile(file.fileId, { discardDirty: true });
    await vi.advanceTimersByTimeAsync(10);

    expect(purgeMock).toHaveBeenCalledWith(file.fileId);
  });

  it.skip("updates FileEntity.backupUri after a backup write", async () => {
    const { service, mediator, filesRegistry } = makeHarness(
      undefined,
      { backupDebounceMs: 50, backupMaxIntervalMs: 5_000 }
    );
    await service.hydrate();
    const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });

    service.handleFileChanged(file, "edited");
    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(filesRegistry.getFile(file.fileId)?.backupUri).toBe("file:///backup.bak");
  });
});

describe("RendererWorkspaceService crash recovery", () => {
  it.skip("persists backupFileId in the snapshot when a backup is written", async () => {
    vi.useFakeTimers();
    try {
      const { service, mediator, saveMock } = makeHarness(
        undefined,
        { backupDebounceMs: 50, backupMaxIntervalMs: 5_000 }
      );
      await service.hydrate();
      const file = await mediator.openFile("file:///a.txt", { mimeType: "text/plain" });
      service.handleFileChanged(file, "edited");
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      saveMock.mockClear();

      await service.flush();

      const persisted = saveMock.mock.calls[0]![0];
      expect(persisted.files[0]!.backupFileId).toMatch(/^bkp-/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores surviving backup content on hydrate and marks file dirty", async () => {
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
    expect(entity.dirtyVsDisk).toBe(true);
    expect(entity.hasRecoveredBackup).toBe(false);
    expect(entity.backupUri).toBe("file:///backup/previous.bak");
    expect(applyRecoveredContentMock).toHaveBeenCalledWith(entity.fileId, "recovered content");
  });

  it("does not mark dirty when no surviving backup exists", async () => {
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
    expect(entity.dirtyVsDisk).toBe(false);
    expect(entity.backupUri).toBeUndefined();
    expect(applyRecoveredContentMock).not.toHaveBeenCalled();
  });

  it("listPendingRestores is empty when backups are auto-restored", async () => {
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

    expect(pending).toHaveLength(0);
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

  it("restores untitled file content from backup on hydrate", async () => {
    const snapshot: WorkspaceSnapshot = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      savedAt: "t",
      files: [
        { uri: "untitled:scratch", mimeType: "text/plain", backupFileId: "untitled-fid" }
      ]
    };
    const { service, filesRegistry, readLatestBackupMock } = makeHarness(snapshot);
    readLatestBackupMock.mockResolvedValueOnce({
      text: "untitled content here",
      savedAt: "t2",
      backupUri: "file:///backup/untitled.bak"
    });

    await service.hydrate();

    const entity = filesRegistry.listFiles()[0]!;
    expect(entity.uri).toBe("untitled:scratch");
    expect(entity.dirtyVsDisk).toBe(true);
    expect(applyRecoveredContentMock).toHaveBeenCalledWith(entity.fileId, "untitled content here");
  });

  it.skip("uses a stable backup id for file-backed editors across restart", async () => {
    vi.useFakeTimers();
    try {
      const initialSnapshot: WorkspaceSnapshot = {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        savedAt: "t",
        files: [{ uri: "file:///persisted.sql", mimeType: "application/sql" }]
      };
      const first = makeHarness(initialSnapshot, {
        backupDebounceMs: 50,
        backupMaxIntervalMs: 5_000
      });
      await first.service.hydrate();

      const opened = await first.mediator.openFile("file:///persisted.sql", {
        mimeType: "application/sql"
      });
      first.service.handleFileChanged(opened, "v1");
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      await Promise.resolve();
      await first.service.flush();
      const persisted = first.saveMock.mock.calls.at(-1)?.[0] as WorkspaceSnapshot;
      const persistedBackupId = persisted.files[0]!.backupFileId;
      expect(persistedBackupId).toMatch(/^bkp-/);

      const second = makeHarness(persisted, {
        backupDebounceMs: 50,
        backupMaxIntervalMs: 5_000
      });
      await second.service.hydrate();
      const reopened = await second.mediator.openFile("file:///persisted.sql", {
        mimeType: "application/sql"
      });
      second.service.handleFileChanged(reopened, "v2");
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();

      expect(second.backupMock).toHaveBeenCalled();
      const calledBackupId = second.backupMock.mock.calls.at(-1)?.[0];
      expect(calledBackupId).toBe(persistedBackupId);
    } finally {
      vi.useRealTimers();
    }
  });
});
