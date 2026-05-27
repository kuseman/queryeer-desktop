import { describe, it, expect, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { coreQueryEngineJdbcPostgresPlugin } from "./plugin";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";

vi.mock("../core.queryengine.jdbc/jdbc-dialect-registry", () => ({
  registerJdbcDialect: vi.fn()
}));

vi.mock("../core.commands/when-expression-template-registry", () => ({
  registerWhenExpressionTemplates: vi.fn()
}));

vi.mock("../core.queryengine/symbol-action-template-registry", () => ({
  registerSymbolActionTemplate: vi.fn()
}));

vi.mock("../core.queryengine.jdbc/tree-action-template-registry", () => ({
  registerTreeActionTemplate: vi.fn()
}));

function createContext(): PluginContext
{
  return {
    commands: { registerCommand: vi.fn() },
    layout: { registerToolbarAction: vi.fn() },
    fileMediator: { getActiveFileId: vi.fn() },
    files: { getFile: vi.fn() },
    settings: { registerSettings: vi.fn() }
  } as unknown as PluginContext;
}

describe("coreQueryEngineJdbcPostgresPlugin", () => {
  it("has correct manifest", () => {
    expect(coreQueryEngineJdbcPostgresPlugin.manifest.id).toBe("core.queryengine.jdbc.postgres");
    expect(coreQueryEngineJdbcPostgresPlugin.manifest.dependencies).toContain("core.queryengine.jdbc");
  });

  it("registers JDBC dialect on activation", () => {
    coreQueryEngineJdbcPostgresPlugin.activate(createContext());

    expect(registerJdbcDialect).toHaveBeenCalledWith(
      expect.objectContaining({
        dialectId: "postgres",
        supportsQueryPlan: true
      })
    );
  });
});
