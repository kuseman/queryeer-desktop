import { describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { writeJdbcContextMetadata } from "./jdbc-metadata";
import { registerJdbcQueryPlanDialectSupport } from "../core.queryengine/query-plan/supported-dialects";

const mocks = vi.hoisted(() => ({
  getConfiguredJdbcConnectionsMock: vi.fn()
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock
}));

describe("jdbc metadata", () => {
  it("writes supportsQueryPlan metadata from dialect", () => {
    registerJdbcQueryPlanDialectSupport("sqlserver");

    const file: FileEntity = {
      fileId: "file-1",
      version: 1,
      uri: "file:///tmp/a.sql",
      mimeType: "application/sql",
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date().toISOString(),
      metadata: {}
    };

    const updates: Array<Record<string, unknown>> = [];
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([
      { connectionId: "conn-sql", title: "Sql", dialectId: "sqlserver", enabled: true },
      { connectionId: "conn-pg", title: "Pg", dialectId: "postgresql", enabled: true }
    ]);

    writeJdbcContextMetadata("file-1", "conn-sql", "db", {
      getFile: () => file,
      updateFile: (_fileId, update) => {
        updates.push(update.metadata as Record<string, unknown>);
        return file;
      }
    });

    writeJdbcContextMetadata("file-1", "conn-pg", "db", {
      getFile: () => file,
      updateFile: (_fileId, update) => {
        updates.push(update.metadata as Record<string, unknown>);
        return file;
      }
    });

    expect(updates[0]?.["core.queryengine.jdbc.supportsQueryPlan"]).toBe(true);
    expect(updates[1]?.["core.queryengine.jdbc.supportsQueryPlan"]).toBe(false);
  });

  it("clears context metadata for disabled connections", () => {
    const file: FileEntity = {
      fileId: "file-1",
      version: 1,
      uri: "file:///tmp/a.sql",
      mimeType: "application/sql",
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date().toISOString(),
      metadata: {
        "core.queryengine.jdbc.connectionTitle": "Disabled",
        "core.queryengine.jdbc.dialectId": "jdbc",
        "core.queryengine.jdbc.supportsQueryPlan": true,
        "core.queryengine.jdbc.database": "old-db"
      }
    };
    const updates: Array<Record<string, unknown>> = [];
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([
      { connectionId: "conn-disabled", title: "Disabled", dialectId: "jdbc", enabled: false }
    ]);

    writeJdbcContextMetadata("file-1", "conn-disabled", "old-db", {
      getFile: () => file,
      updateFile: (_fileId, update) => {
        updates.push(update.metadata as Record<string, unknown>);
        return file;
      }
    });

    expect(updates[0]?.["core.queryengine.jdbc.connectionTitle"]).toBeUndefined();
    expect(updates[0]?.["core.queryengine.jdbc.dialectId"]).toBeUndefined();
    expect(updates[0]?.["core.queryengine.jdbc.supportsQueryPlan"]).toBeUndefined();
    expect(updates[0]?.["core.queryengine.jdbc.database"]).toBeUndefined();
  });
});
