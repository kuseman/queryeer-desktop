import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { JdbcConnectionDefinition } from "./jdbc-settings";

const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getConfiguredJdbcConnectionsMock: vi.fn<() => JdbcConnectionDefinition[]>(() => [])
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke: mocks.invokeMock })
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock
}));

import { JdbcConnectionSelector } from "./JdbcConnectionSelector";
import { JDBC_NAV_DB_KEY } from "./jdbc-navigation-types";

const connections: JdbcConnectionDefinition[] = [
  { connectionId: "conn-a", title: "DB Alpha", dialectId: "jdbc", url: "jdbc:h2:a", enabled: true },
  { connectionId: "conn-b", title: "DB Beta", dialectId: "jdbc", url: "jdbc:h2:b", enabled: true }
];

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
    capabilities: { registerCapabilities: vi.fn(), hasCapability: vi.fn(), registerContentCategory: vi.fn(), getContentCategory: vi.fn() },
    mimeIcons: { registerMimeIcon: vi.fn(), getMimeIcon: vi.fn(), listMimeIcons: vi.fn() }
  } as unknown as FilesRegistry;
}

function makeFileMediator(file: FileEntity): FileMediator {
  return {
    bindEngine: vi.fn(async () => file),
    openFile: vi.fn(),
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
    mocks.invokeMock.mockReset();
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

  it("calls bindEngine when connection dropdown changes", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file);
    const fileMediator = makeFileMediator(file);
    mocks.invokeMock.mockResolvedValue([]);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
    });

    const select = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-connection-select']");
    await act(async () => {
      select!.value = "conn-b";
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(fileMediator.bindEngine).toHaveBeenCalledWith("file-1", "jdbc", "conn-b");
  });

  it("calls setEditorState when database dropdown changes", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file);
    const fileMediator = makeFileMediator(file);
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
    });

    // Wait for databases to load
    await act(async () => {});

    const dbSelect = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-database-select']");
    await act(async () => {
      dbSelect!.value = "mydb";
      dbSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(filesRegistry.setEditorState).toHaveBeenCalledWith("file-1", JDBC_NAV_DB_KEY, {
      connectionId: "conn-a",
      database: "mydb"
    });
  });

  it("shows loading state while databases load", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file);
    const fileMediator = makeFileMediator(file);
    let resolveDb!: (v: unknown) => void;
    mocks.invokeMock.mockReturnValue(new Promise((r) => (resolveDb = r)));

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
    });

    expect(container.querySelector("[data-testid='jdbc-db-loading']")).not.toBeNull();

    await act(async () => {
      resolveDb([]);
    });

    expect(container.querySelector("[data-testid='jdbc-db-loading']")).toBeNull();
  });

  it("restores persisted database selection on initial render", async () => {
    const file = makeFile({ engineBinding: { engineId: "jdbc", connectionId: "conn-a" } });
    const filesRegistry = makeFilesRegistry(file, { [JDBC_NAV_DB_KEY]: { connectionId: "conn-a", database: "mydb" } });
    const fileMediator = makeFileMediator(file);
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    await act(async () => {
      root.render(
        <JdbcConnectionSelector fileId="file-1" fileMediator={fileMediator} filesRegistry={filesRegistry} />
      );
    });

    await act(async () => {});

    const dbSelect = container.querySelector<HTMLSelectElement>("[data-testid='jdbc-database-select']");
    expect(dbSelect?.value).toBe("mydb");
  });
});
