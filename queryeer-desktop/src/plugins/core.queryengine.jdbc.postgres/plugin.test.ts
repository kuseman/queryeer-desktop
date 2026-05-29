import { beforeEach, describe, it, expect, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { coreQueryEngineJdbcPostgresPlugin } from "./plugin";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";
import { registerSymbolActionTemplate } from "../core.queryengine/symbol-action-template-registry";

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("registers describe action using unqualified symbol attribute name", () => {
    const context = createContext();

    coreQueryEngineJdbcPostgresPlugin.activate(context);

    expect(context.commands.registerCommand).not.toHaveBeenCalled();
    expect(registerSymbolActionTemplate).toHaveBeenCalledWith(expect.objectContaining({
      id: "core.queryengine.jdbc.symbolAction.postgresDescribe",
      action: expect.objectContaining({
        query: expect.stringContaining("symbol.attributes.name")
      })
    }));
  });

  it("does not own shared plan commands or toolbar actions", () => {
    const context = createContext();

    coreQueryEngineJdbcPostgresPlugin.activate(context);

    const registerCommand = vi.mocked(context.commands.registerCommand);
    const registerToolbarAction = vi.mocked(context.layout.registerToolbarAction);
    expect(registerCommand).not.toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringContaining("Plan")
    }));
    expect(registerToolbarAction).not.toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining("Plan")
    }));
  });
});
