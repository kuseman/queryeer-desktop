import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { fileUriToPath } from "@queryeer/api/files/Resolvers";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";
import { SqliteConnectionForm } from "./SqliteConnectionForm";
import { SqliteDatabaseWelcomeEditor } from "./SqliteDatabaseWelcomeEditor";

const SQLITE_DIALECT_ID = "sqlite";
const SQLITE_MIME_TYPE = "application/vnd.sqlite3";
const SQLITE_EXTENSIONS = ["sqlite", "sqlite3", "db", "db3", "s3db", "sl3"];

export const coreQueryEngineJdbcSqlitePlugin: Plugin = {
  manifest: {
    id: "core.queryengine.jdbc.sqlite",
    name: "Core Query Engine JDBC SQLite",
    version: "0.1.0",
    kind: "core",
    description: "SQLite dialect support for JDBC connections",
    dependencies: ["core.queryengine", "core.queryengine.jdbc", "core.settings", "core.files"],
    requiredCapabilities: ["query.engine"],
    providesCapabilities: ["query.engine.jdbc.sqlite"]
  },
  activate: (context) => {
    context.jdbcDrivers.registerDriver({
      dialectId: SQLITE_DIALECT_ID,
      displayName: "SQLite JDBC Driver",
      groupId: "org.xerial",
      artifactId: "sqlite-jdbc",
      driverClassName: "org.sqlite.JDBC",
      downloadPageUrl: "https://github.com/xerial/sqlite-jdbc/releases"
    });

    registerJdbcDialect({
      dialectId: SQLITE_DIALECT_ID,
      ConnectionForm: SqliteConnectionForm
    });

    context.files.registerMimeResolver((_uri, hint) => {
      const ext = hint?.extension?.toLowerCase();
      if (ext && SQLITE_EXTENSIONS.includes(ext)) {
        return SQLITE_MIME_TYPE;
      }
      return undefined;
    });

    context.files.capabilities.registerCapabilities(SQLITE_MIME_TYPE, []);
    context.files.capabilities.registerLabel?.(SQLITE_MIME_TYPE, "SQLite Database");
    context.files.capabilities.registerContentCategory(SQLITE_MIME_TYPE, "binary");

    context.layout.registerEditor({
      id: "core.queryengine.jdbc.sqlite.welcome",
      title: "SQLite Database",
      order: 100,
      supportedMimeTypes: [SQLITE_MIME_TYPE],
      openIntents: ["view", "edit"],
      priority: 10,
      render: (renderCtx) => {
        const activeFile = renderCtx?.activeFile;
        if (!activeFile) return null;
        const filePath = fileUriToPath(activeFile.uri);
        return (
          <SqliteDatabaseWelcomeEditor
            filePath={filePath}
            fileMediator={context.fileMediator}
            files={context.files}
            onDone={() => {
              context.fileMediator.closeFile(activeFile.fileId).catch(() => {});
            }}
          />
        );
      }
    });
  }
};
