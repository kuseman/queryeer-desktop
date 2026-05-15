import { beforeEach, describe, expect, it } from "vitest";
import { registerJdbcDialect, getJdbcDialect } from "./jdbc-dialect-registry";

describe("jdbc-dialect-registry", () => {
  beforeEach(() => {
    // Clear the registry before each test by unregistering
    // (module-level Map, so we re-register per test)
  });

  it("returns undefined for unregistered dialect", () => {
    expect(getJdbcDialect("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves a dialect contribution", () => {
    const contribution = { dialectId: "testdialect" };
    registerJdbcDialect(contribution);
    expect(getJdbcDialect("testdialect")).toBe(contribution);
  });

  it("overwrites existing registration for the same dialectId", () => {
    registerJdbcDialect({ dialectId: "dup" });
    const updated = { dialectId: "dup", ConnectionForm: (() => null) as unknown as import("./jdbc-dialect-registry").JdbcDialectContribution["ConnectionForm"] };
    registerJdbcDialect(updated);
    expect(getJdbcDialect("dup")).toBe(updated);
  });

  it("stores multiple dialects independently", () => {
    const a = { dialectId: "dialect-a" };
    const b = { dialectId: "dialect-b" };
    registerJdbcDialect(a);
    registerJdbcDialect(b);
    expect(getJdbcDialect("dialect-a")).toBe(a);
    expect(getJdbcDialect("dialect-b")).toBe(b);
  });
});
