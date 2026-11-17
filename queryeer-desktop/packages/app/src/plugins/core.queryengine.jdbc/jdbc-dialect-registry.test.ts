import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  registerJdbcQueryPlanDialectSupportMock: vi.fn(),
  unregisterJdbcQueryPlanDialectSupportMock: vi.fn()
}));

vi.mock("../core.queryengine/query-plan/supported-dialects", () => ({
  registerJdbcQueryPlanDialectSupport: mocks.registerJdbcQueryPlanDialectSupportMock,
  unregisterJdbcQueryPlanDialectSupport: mocks.unregisterJdbcQueryPlanDialectSupportMock
}));

import { registerJdbcDialect, getJdbcDialect, subscribeJdbcDialects, createJdbcDialectRegistry } from "./jdbc-dialect-registry";

describe("jdbc-dialect-registry", () => {
  beforeEach(() => {
    mocks.registerJdbcQueryPlanDialectSupportMock.mockReset();
    mocks.unregisterJdbcQueryPlanDialectSupportMock.mockReset();
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

  it("registers query-plan capability when dialect opts in", () => {
    registerJdbcDialect({ dialectId: "plan-dialect", supportsQueryPlan: true });

    expect(mocks.registerJdbcQueryPlanDialectSupportMock).toHaveBeenCalledWith("plan-dialect");
  });

  it("does not register query-plan capability when dialect does not opt in", () => {
    registerJdbcDialect({ dialectId: "non-plan-dialect" });

    expect(mocks.registerJdbcQueryPlanDialectSupportMock).not.toHaveBeenCalled();
  });

  it("removes a dialect and its query-plan support when disposed", () => {
    const registration = createJdbcDialectRegistry().registerDialect({ dialectId: "disposable", supportsQueryPlan: true });

    registration.dispose();

    expect(getJdbcDialect("disposable")).toBeUndefined();
    expect(mocks.unregisterJdbcQueryPlanDialectSupportMock).toHaveBeenCalledWith("disposable");
  });

  it("disposing a replaced registration leaves the newer one", () => {
    const first = registerJdbcDialect({ dialectId: "replaced" });
    const second = { dialectId: "replaced" };
    registerJdbcDialect(second);

    first.dispose();

    expect(getJdbcDialect("replaced")).toBe(second);
  });

  it("notifies subscribers when dialects change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeJdbcDialects(listener);

    const registration = registerJdbcDialect({ dialectId: "notified" });
    registration.dispose();
    unsubscribe();
    registerJdbcDialect({ dialectId: "after-unsubscribe" });

    expect(listener).toHaveBeenCalledTimes(2);
  });
});
