import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import type { JdbcConnectionDefinition } from "./jdbc-settings";

const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_req: unknown): Promise<unknown> => []),
  getConfiguredJdbcConnectionsMock: vi.fn<() => JdbcConnectionDefinition[]>(() => [])
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke: mocks.invokeMock })
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock
}));

import { createJdbcDatabaseQuickCommandProvider } from "./jdbc-database-quick-command";
import { JDBC_NAV_DB_KEY } from "./jdbc-navigation-types";
import { resetJdbcDatabaseCacheForTests } from "./jdbc-database-cache";

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

function makeContext(focusMock?: ReturnType<typeof vi.fn>): Pick<PluginContext, "fileMediator" | "files" | "editors"> {
  return {
    fileMediator: {
      bindEngine: vi.fn(async () => makeFile())
    } as unknown as PluginContext["fileMediator"],
    files: {
      setEditorState: vi.fn(),
      getFile: vi.fn(() => undefined),
      updateFile: vi.fn()
    } as unknown as PluginContext["files"],
    editors: {
      getActiveEditor: vi.fn(() => (focusMock
        ? ({ focus: { focus: focusMock } } as unknown as PluginContext["editors"] extends { getActiveEditor: () => infer T } ? T : never)
        : null)),
      onActiveEditorChanged: vi.fn(() => ({ dispose: vi.fn() }))
    } as unknown as PluginContext["editors"]
  };
}

const connections: JdbcConnectionDefinition[] = [
  { connectionId: "conn-a", title: "DB Alpha", dialectId: "jdbc", url: "jdbc:h2:a", enabled: true },
  { connectionId: "conn-b", title: "DB Beta", dialectId: "jdbc", url: "jdbc:h2:b", enabled: true }
];

describe("createJdbcDatabaseQuickCommandProvider", () => {
  beforeEach(() => {
    resetJdbcDatabaseCacheForTests();
    vi.useFakeTimers();
    mocks.invokeMock.mockReset();
    mocks.invokeMock.mockResolvedValue([]);
    mocks.getConfiguredJdbcConnectionsMock.mockReset();
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue(connections);
  });

  it("returns empty items when there is no active file", async () => {
    const provider = createJdbcDatabaseQuickCommandProvider(makeContext());
    const items = await provider.getItems("", { activeFile: undefined, openFiles: [] });
    expect(items).toHaveLength(0);
  });

  it("returns empty items when no connections are enabled", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([]);
    const provider = createJdbcDatabaseQuickCommandProvider(makeContext());
    const items = await provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });
    expect(items).toHaveLength(0);
  });

  it("fetches databases for all enabled connections and flattens them", async () => {
    mocks.invokeMock.mockImplementation(async (req: unknown) => {
      const payload = (req as { payload?: { connectionId: string } }).payload;
      if (payload?.connectionId === "conn-a") {
        return [
          { id: "db:alpha1", name: "alpha1", kind: "database", children: [], attributes: {} },
          { id: "db:alpha2", name: "alpha2", kind: "database", children: [], attributes: {} }
        ];
      }
      if (payload?.connectionId === "conn-b") {
        return [
          { id: "db:beta1", name: "beta1", kind: "database", children: [], attributes: {} }
        ];
      }
      return [];
    });

    const provider = createJdbcDatabaseQuickCommandProvider(makeContext());
    const items = await provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });

    expect(items).toHaveLength(3);
    expect(items.map((i) => i.title)).toEqual([
      "DB Alpha / alpha1",
      "DB Alpha / alpha2",
      "DB Beta / beta1"
    ]);
  });

  it("falls back to schema names when no databases are returned", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "sch:public", name: "public", kind: "schema", children: [], attributes: {} }
    ]);

    const provider = createJdbcDatabaseQuickCommandProvider(makeContext());
    const items = await provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });

    expect(items.map((i) => i.title)).toContain("DB Alpha / public");
    expect(items.map((i) => i.title)).toContain("DB Beta / public");
  });

  it("shows a placeholder item when a connection has no databases", async () => {
    mocks.invokeMock.mockResolvedValue([]);

    const provider = createJdbcDatabaseQuickCommandProvider(makeContext());
    const items = await provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });

    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("DB Alpha / — no databases —");
    expect(items[1]?.title).toBe("DB Beta / — no databases —");
  });

  it("does not block while uncached database loads are still pending", async () => {
    mocks.invokeMock.mockImplementation(() => new Promise(() => {}));

    const provider = createJdbcDatabaseQuickCommandProvider(makeContext());
    const promise = provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });

    await vi.advanceTimersByTimeAsync(500);
    const items = await promise;

    expect(items).toHaveLength(0);
    expect(mocks.invokeMock).toHaveBeenCalledTimes(2);
  });

  it("binds engine and sets editor state when a database item is selected", async () => {
    mocks.invokeMock.mockImplementation(async (req: unknown) => {
      const payload = (req as { payload?: { connectionId: string } }).payload;
      if (payload?.connectionId === "conn-a") {
        return [{ id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }];
      }
      return [];
    });

    const context = makeContext();
    const provider = createJdbcDatabaseQuickCommandProvider(context);
    const items = await provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });

    const dbItem = items.find((i) => i.id === "jdbc.db.conn-a::mydb");
    expect(dbItem).toBeDefined();
    await dbItem!.action();

    expect(context.fileMediator.bindEngine).toHaveBeenCalledWith("file-1", "jdbc", "conn-a");
    expect(context.files.setEditorState).toHaveBeenCalledWith("file-1", JDBC_NAV_DB_KEY, {
      connectionId: "conn-a",
      database: "mydb"
    });
  });

  it("binds engine and clears editor state when the placeholder item is selected", async () => {
    mocks.invokeMock.mockResolvedValue([]);

    const context = makeContext();
    const provider = createJdbcDatabaseQuickCommandProvider(context);
    const items = await provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });

    await items[0]!.action();

    expect(context.fileMediator.bindEngine).toHaveBeenCalledWith("file-1", "jdbc", "conn-a");
    expect(context.files.setEditorState).toHaveBeenCalledWith("file-1", JDBC_NAV_DB_KEY, undefined);
  });

  it("refocuses active editor after selecting a database", async () => {
    mocks.invokeMock.mockImplementation(async (req: unknown) => {
      const payload = (req as { payload?: { connectionId: string } }).payload;
      if (payload?.connectionId === "conn-a") {
        return [{ id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }];
      }
      return [];
    });
    const focusMock = vi.fn();
    const context = makeContext(focusMock);
    const provider = createJdbcDatabaseQuickCommandProvider(context);
    const items = await provider.getItems("", {
      activeFile: makeFile(),
      openFiles: [makeFile()]
    });

    const dbItem = items.find((i) => i.id === "jdbc.db.conn-a::mydb");
    expect(dbItem).toBeDefined();
    await dbItem!.action();
    await vi.runAllTimersAsync();

    expect(focusMock).toHaveBeenCalledTimes(1);
  });

  it("has the expected prefix, label, order and when clause", () => {
    const provider = createJdbcDatabaseQuickCommandProvider(makeContext());
    expect(provider.prefix).toBe("$");
    expect(provider.label).toBe("Select Database");
    expect(provider.order).toBe(15);
    expect(provider.when).toBe("activeFile.mimeType == 'application/sql'");
  });
});
