import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FileMediator } from "@queryeer/api/files/FileMediator";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { JdbcConnectionDefinition } from "./jdbc-settings";
import { JDBC_NAV_DB_KEY } from "./jdbc-navigation-types";

const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getConfiguredJdbcConnectionsMock: vi.fn<() => JdbcConnectionDefinition[]>(() => []),
  backendStatusListeners: new Set<(status: { state: string }) => void>()
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke: mocks.invokeMock })
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock
}));

vi.mock("../../renderer/shell/backend-status-service", () => ({
  getBackendStatusService: () => ({
    subscribe: vi.fn((listener: (status: { state: string }) => void) => {
      mocks.backendStatusListeners.add(listener);
      return () => mocks.backendStatusListeners.delete(listener);
    })
  })
}));

import { JdbcConnectionSelector } from "./JdbcConnectionSelector";
import { resetJdbcDatabaseCacheForTests } from "./jdbc-database-cache";

const connections: JdbcConnectionDefinition[] = [
  { connectionId: "conn-a", title: "DB Alpha", dialectId: "jdbc", url: "jdbc:h2:a", enabled: true },
  { connectionId: "conn-b", title: "DB Beta", dialectId: "jdbc", url: "jdbc:h2:b", enabled: true }
];

const topSnapshot = [
  {
    id: "__databases__",
    name: "Databases",
    kind: "databases_container",
    children: [{ id: "database:db1", name: "db1", kind: "database", children: null, attributes: {} }],
    attributes: {}
  }
];

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "test.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function makeFilesRegistry(file: FileEntity, editorState: Record<string, unknown> = {}): FilesRegistry {
  const subscribers = new Set<(files: FileEntity[]) => void>();
  let currentFile = file;
  return {
    getFile: () => currentFile,
    listFiles: () => [currentFile],
    openFile: vi.fn(),
    closeFile: vi.fn(),
    updateFile: vi.fn((_fileId, update) => {
      currentFile = { ...currentFile, ...update };
      for (const sub of subscribers) sub([currentFile]);
      return currentFile;
    }),
    subscribe: vi.fn((sub) => {
      subscribers.add(sub);
      return () => subscribers.delete(sub);
    }),
    registerMimeResolver: vi.fn(),
    registerEditorResolver: vi.fn(),
    classifyUri: vi.fn(),
    resolveEditor: vi.fn(),
    getEditorState: vi.fn((_, key) => editorState[key]),
    setEditorState: vi.fn(),
    markDirty: vi.fn(),
    capabilities: { registerCapabilities: vi.fn(), registerLabel: vi.fn(), registerPreferredNewFileMimeType: vi.fn(), listPreferredNewFileMimeTypes: vi.fn(() => []), getLabel: vi.fn(), hasCapability: vi.fn(),         listMimeTypesByCapability: vi.fn(() => []), listAllMimeTypes: vi.fn(() => []), registerContentCategory: vi.fn(), getContentCategory: vi.fn() },
    mimeIcons: { registerMimeIcon: vi.fn(), getMimeIcon: vi.fn(), listMimeIcons: vi.fn() }
  } as unknown as FilesRegistry;
}

function makeFileMediator(file: FileEntity): FileMediator {
  return {
    bindEngine: vi.fn(async () => file),
    openFile: vi.fn(),
    createUntitledFile: vi.fn(),
    getUntitledCounter: vi.fn(() => 0),
    setUntitledCounter: vi.fn(),
    closeFile: vi.fn(),
    saveFile: vi.fn(),
    setActiveFileId: vi.fn(),
    getActiveFileId: vi.fn(() => file.fileId),
    onActiveFileChanged: vi.fn(() => () => {}),
    setContextFileId: vi.fn(),
    getContextFileId: vi.fn(),
    reloadFile: vi.fn(),
    acceptExternalChange: vi.fn(),
    discardExternalChange: vi.fn()
  } as unknown as FileMediator;
}

describe("JdbcConnectionSelector", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    resetJdbcDatabaseCacheForTests();
    mocks.invokeMock.mockReset();
    mocks.backendStatusListeners.clear();
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue(connections);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders the current connection from engineBinding", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file);
    const fileMediator = makeFileMediator(file);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
    });

    const select = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-connection-select']");
    expect(select?.value).toBe("conn-a");
  });

  it("clears disabled restored connection and database", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([
      ...connections,
      { connectionId: "conn-disabled", title: "Disabled", dialectId: "jdbc", url: "jdbc:h2:disabled", enabled: false }
    ]);
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-disabled" } });
    const filesRegistry = makeFilesRegistry(file, {
      [JDBC_NAV_DB_KEY]: { connectionId: "conn-disabled", database: "old-db" }
    });
    const fileMediator = makeFileMediator(file);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
      await flush();
    });

    expect(fileMediator.bindEngine).toHaveBeenCalledWith("file-1", "jdbc", undefined);
    expect(filesRegistry.setEditorState).toHaveBeenCalledWith("file-1", JDBC_NAV_DB_KEY, undefined);
    const connectionSelect = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-connection-select']");
    expect(connectionSelect?.value).toBe("");
    const databaseSelect = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-database-select']");
    const databaseOptions = Array.from(databaseSelect?.querySelectorAll("option") ?? []).map((option) => option.value);
    expect(databaseSelect?.value).toBe("");
    expect(databaseOptions).not.toContain("old-db");
  });

  it("clears restored database when it belongs to another connection", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file, {
      [JDBC_NAV_DB_KEY]: { connectionId: "conn-b", database: "old-db" }
    });
    const fileMediator = makeFileMediator(file);
    mocks.invokeMock.mockResolvedValue([]);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
      await flush();
    });

    expect(filesRegistry.setEditorState).toHaveBeenCalledWith("file-1", JDBC_NAV_DB_KEY, undefined);
    const databaseSelect = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-database-select']");
    expect(databaseSelect?.value).toBe("");
  });

  it("loads databases silently on initial render", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file);
    const fileMediator = makeFileMediator(file);
    mocks.invokeMock.mockResolvedValue([]);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
    });

    await act(async () => {});

    expect(mocks.invokeMock).toHaveBeenCalledWith(
      {
        engineId: "jdbc",
        action: "jdbc.schema.refresh",
        payload: { connectionId: "conn-a", scope: "top", mode: "due", waitForCompletion: false }
      },
      { silent: true }
    );
    expect(mocks.invokeMock).toHaveBeenCalledWith(
      {
        engineId: "jdbc",
        action: "jdbc.schema.snapshot",
        payload: { connectionId: "conn-a", scope: "top" }
      },
      { silent: true }
    );
  });

  it("prewarms selected database schema without blocking", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file);
    const fileMediator = makeFileMediator(file);
    mocks.invokeMock.mockResolvedValue(topSnapshot);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
    });

    await act(async () => {});

    const select = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-database-select']")!;
    await act(async () => {
      select.value = "db1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(mocks.invokeMock).toHaveBeenCalledWith(
      {
        engineId: "jdbc",
        action: "jdbc.schema.refresh",
        payload: { connectionId: "conn-a", scope: "deep", target: { database: "db1" }, mode: "due", waitForCompletion: false }
      },
      { silent: true }
    );
  });
});
