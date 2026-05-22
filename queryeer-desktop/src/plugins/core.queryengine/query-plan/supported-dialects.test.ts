import { describe, expect, it } from "vitest";
import type { FileEntity } from "../../../contracts/files/FileEntity";
import {
  hasActiveQueryPlanDialect,
  registerJdbcQueryPlanDialectSupport,
  supportsQueryPlanForJdbcDialect
} from "./supported-dialects";

function createFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///tmp/test.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("query plan supported dialects", () => {
  it("recognizes supported JDBC query-plan dialects", () => {
    registerJdbcQueryPlanDialectSupport("sqlserver");

    expect(supportsQueryPlanForJdbcDialect("sqlserver")).toBe(true);
    expect(supportsQueryPlanForJdbcDialect("dialect-not-registered")).toBe(false);
    expect(supportsQueryPlanForJdbcDialect(undefined)).toBe(false);
  });

  it("detects support from active file context", () => {
    registerJdbcQueryPlanDialectSupport("sqlserver");

    expect(hasActiveQueryPlanDialect(createFile({
      engineBinding: { engineId: "jdbc", connectionId: "conn-1" },
      metadata: { "core.queryengine.jdbc.dialectId": "sqlserver" }
    }))).toBe(true);

    expect(hasActiveQueryPlanDialect(createFile({
      engineBinding: { engineId: "jdbc", connectionId: "conn-1" },
      metadata: { "core.queryengine.jdbc.dialectId": "dialect-not-registered" }
    }))).toBe(false);

    expect(hasActiveQueryPlanDialect(createFile({
      engineBinding: { engineId: "payloadbuilder" },
      metadata: { "core.queryengine.jdbc.dialectId": "sqlserver" }
    }))).toBe(false);
  });
});
