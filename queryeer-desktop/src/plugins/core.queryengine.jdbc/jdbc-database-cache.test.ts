import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(async (_req: unknown): Promise<unknown> => [])
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke: mocks.invokeMock })
}));

import { getJdbcDatabaseCache, resetJdbcDatabaseCacheForTests } from "./jdbc-database-cache";

describe("JdbcDatabaseCache", () => {
  beforeEach(() => {
    resetJdbcDatabaseCacheForTests();
    mocks.invokeMock.mockReset();
    mocks.invokeMock.mockResolvedValue([]);
  });

  it("fetches from backend on first load", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    const dbs = await cache.load("conn-a");

    expect(dbs).toEqual(["mydb"]);
    expect(mocks.invokeMock).toHaveBeenCalledOnce();
  });

  it("returns cached value without fetching again within TTL", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    await cache.load("conn-a");
    mocks.invokeMock.mockClear();

    const dbs = await cache.load("conn-a");

    expect(dbs).toEqual(["mydb"]);
    expect(mocks.invokeMock).not.toHaveBeenCalled();
  });

  it("re-fetches after TTL expires", async () => {
    vi.useFakeTimers();
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    await cache.load("conn-a");

    vi.advanceTimersByTime(31_000);
    mocks.invokeMock.mockClear();
    mocks.invokeMock.mockResolvedValue([
      { id: "db:newdb", name: "newdb", kind: "database", children: [], attributes: {} }
    ]);

    const dbs = await cache.load("conn-a");

    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
    expect(dbs).toEqual(["newdb"]);
    vi.useRealTimers();
  });

  it("falls back to schema names when no databases are returned", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "sch:public", name: "public", kind: "schema", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    const dbs = await cache.load("conn-a");

    expect(dbs).toEqual(["public"]);
  });

  it("returns empty array on fetch error", async () => {
    mocks.invokeMock.mockRejectedValue(new Error("backend down"));

    const cache = getJdbcDatabaseCache();
    const dbs = await cache.load("conn-a");

    expect(dbs).toEqual([]);
  });

  it("falls back to jdbc.schema.fetch when snapshot is empty", async () => {
    mocks.invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "sch:dbo", name: "dbo", kind: "schema", children: [], attributes: {} }]);

    const cache = getJdbcDatabaseCache();
    const dbs = await cache.load("conn-a");

    expect(dbs).toEqual(["dbo"]);
    expect(mocks.invokeMock).toHaveBeenNthCalledWith(
      2,
      {
        engineId: "jdbc",
        action: "jdbc.schema.fetch",
        payload: { connectionId: "conn-a", scope: "top" }
      },
      { silent: true }
    );
  });

  it("deduplicates concurrent loads for the same connection", async () => {
    let resolveFetch!: (value: unknown) => void;
    mocks.invokeMock.mockReturnValue(new Promise((r) => (resolveFetch = r)));

    const cache = getJdbcDatabaseCache();
    const p1 = cache.load("conn-a");
    const p2 = cache.load("conn-a");

    resolveFetch!([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toEqual(["mydb"]);
    expect(r2).toEqual(["mydb"]);
    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers when a new entry is stored", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    const listener = vi.fn();
    cache.subscribe(listener);

    await cache.load("conn-a");

    expect(listener).toHaveBeenCalledWith("conn-a", ["mydb"]);
  });

  it("unsubscribe removes the listener", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    const listener = vi.fn();
    const unsub = cache.subscribe(listener);
    unsub();

    await cache.load("conn-a");

    expect(listener).not.toHaveBeenCalled();
  });

  it("invalidate removes a single entry", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    await cache.load("conn-a");
    cache.invalidate("conn-a");

    expect(cache.get("conn-a")).toBeUndefined();
  });

  it("invalidate with no argument clears all entries", async () => {
    mocks.invokeMock.mockResolvedValue([
      { id: "db:mydb", name: "mydb", kind: "database", children: [], attributes: {} }
    ]);

    const cache = getJdbcDatabaseCache();
    await cache.load("conn-a");
    await cache.load("conn-b");
    cache.invalidate();

    expect(cache.get("conn-a")).toBeUndefined();
    expect(cache.get("conn-b")).toBeUndefined();
  });

  it("uses jdbc.schema.snapshot action", async () => {
    mocks.invokeMock.mockResolvedValue([]);

    const cache = getJdbcDatabaseCache();
    await cache.load("conn-a");

    expect(mocks.invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engineId: "jdbc",
        action: "jdbc.schema.snapshot",
        payload: expect.objectContaining({ connectionId: "conn-a", scope: "top" })
      }),
      expect.anything()
    );
  });
});
