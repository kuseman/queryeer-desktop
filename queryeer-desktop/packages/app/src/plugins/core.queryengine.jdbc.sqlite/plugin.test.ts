import { beforeEach, describe, it, expect, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { coreQueryEngineJdbcSqlitePlugin } from "./plugin";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";

vi.mock("../core.queryengine.jdbc/jdbc-dialect-registry", () => ({
  registerJdbcDialect: vi.fn()
}));

function createContext(): PluginContext
{
  return {
    files: {
      registerMimeResolver: vi.fn(),
      capabilities: {
        registerCapabilities: vi.fn(),
        registerLabel: vi.fn(),
        registerContentCategory: vi.fn()
      }
    },
    layout: {
      registerEditor: vi.fn()
    },
    fileMediator: {
      closeFile: vi.fn(),
      createUntitledFile: vi.fn()
    }
  } as unknown as PluginContext;
}

describe("coreQueryEngineJdbcSqlitePlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct manifest", () => {
    expect(coreQueryEngineJdbcSqlitePlugin.manifest.id).toBe("core.queryengine.jdbc.sqlite");
    expect(coreQueryEngineJdbcSqlitePlugin.manifest.dependencies).toContain("core.queryengine.jdbc");
  });

  it("registers JDBC dialect on activation", () => {
    coreQueryEngineJdbcSqlitePlugin.activate(createContext());

    expect(registerJdbcDialect).toHaveBeenCalledWith(
      expect.objectContaining({
        dialectId: "sqlite"
      })
    );
  });

  it("registers mime resolver for SQLite extensions on activation", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlitePlugin.activate(context);

    expect(context.files.registerMimeResolver).toHaveBeenCalledWith(expect.any(Function));
  });

  it("registers capabilities for the SQLite mime type", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlitePlugin.activate(context);

    expect(context.files.capabilities.registerCapabilities).toHaveBeenCalledWith(
      "application/vnd.sqlite3",
      []
    );
  });

  it("registers editor for the SQLite mime type", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlitePlugin.activate(context);

    expect(context.layout.registerEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.jdbc.sqlite.welcome",
        supportedMimeTypes: ["application/vnd.sqlite3"]
      })
    );
  });

  it("preserves an absolute POSIX path when rendering the SQLite editor", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlitePlugin.activate(context);
    const registeredEditor = (context.layout.registerEditor as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      render: (renderContext: { activeFile: { fileId: string; uri: string } }) => { props: { filePath: string } };
    };

    const rendered = registeredEditor.render({
      activeFile: {
        fileId: "sqlite-file",
        uri: "file:///Users/alice/My%20Database.sqlite"
      }
    });

    expect(rendered.props.filePath).toBe("/Users/alice/My Database.sqlite");
  });
});
