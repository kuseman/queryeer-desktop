import { describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
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
      { connectionId: "conn-sql", title: "Sql", dialectId: "sqlserver" },
      { connectionId: "conn-pg", title: "Pg", dialectId: "postgresql" }
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
});
