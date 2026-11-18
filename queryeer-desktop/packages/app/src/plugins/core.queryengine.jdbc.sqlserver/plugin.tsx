import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";
import { getExpressionRuntime } from "../core.expressions/runtime";
import { SqlServerConnectionForm } from "./SqlServerConnectionForm";

const SQLSERVER_DIALECT_ID = "sqlserver";
const SQLSERVER_PLAN_OUTPUT_SETTING_ID = "core.queryengine.jdbc.sqlserver.planXmlOutput";
const SQLSERVER_FILE_DIALECT_WHEN = `activeFile.metadata.core.queryengine.jdbc?.dialectId == '${SQLSERVER_DIALECT_ID}'`;
const SQLSERVER_NODE_DIALECT_WHEN = `node.dialectId == '${SQLSERVER_DIALECT_ID}'`;

function registerSqlServerExpressionFunctions(): void {
  const registry = getExpressionRuntime().getFunctionRegistry();
  if (registry.listFunctions().some((entry) => entry.fqName === "sqlserver.identifier")) {
    return;
  }
  registry.registerNamespace("sqlserver", {
    identifier: (value: unknown) => `[${String(value).replace(/]/g, "]]")}]`
  });
}

export const coreQueryEngineJdbcSqlServerPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.jdbc.sqlserver",
    name: "Core Query Engine JDBC SQL Server",
    version: "0.1.0",
    kind: "core",
    description: "SQL Server dialect support for JDBC connections",
    dependencies: ["core.queryengine", "core.queryengine.jdbc", "core.settings", "core.commands"],
    requiredCapabilities: ["query.engine"],
    providesCapabilities: ["query.engine.jdbc.sqlserver"]
  },
  activate: (context) => {
    context.jdbcDrivers.registerDriver({
      dialectId: SQLSERVER_DIALECT_ID,
      displayName: "Microsoft JDBC Driver for SQL Server",
      groupId: "com.microsoft.sqlserver",
      artifactId: "mssql-jdbc",
      driverClassName: "com.microsoft.sqlserver.jdbc.SQLServerDriver",
      compatibleVersionRegex: "\\.jre11$",
      downloadPageUrl: "https://learn.microsoft.com/sql/connect/jdbc/download-microsoft-jdbc-driver-for-sql-server",
      companionArtifacts: [{
        id: "native-auth",
        displayName: "Windows Native Authentication",
        kind: "nativeLibrary",
        platforms: [
          { os: "windows", arch: "x64" },
          { os: "windows", arch: "x86" }
        ],
        source: {
          type: "githubReleaseArchive",
          repository: "microsoft/mssql-jdbc",
          releaseTagTemplate: "v{releaseVersion}",
          assetName: "mssql-jdbc_auth.zip",
          driverVersionToReleaseVersion: { pattern: "^([0-9]+\\.[0-9]+\\.[0-9]+)\\.jre[0-9]+$", replacement: "$1" },
          archiveEntryTemplate: "{arch}/mssql-jdbc_auth-{releaseVersion}.{arch}.dll"
        },
        targetDirectory: "libNative",
        expectedFileExtension: ".dll",
        versionLockedToDriver: true
      }]
    });

    registerSqlServerExpressionFunctions();

    // A hand-written form (several authentication types share fields, some options are Windows-only), so its own subtitle and validation
    context.jdbcDialects.registerDialect({
      dialectId: SQLSERVER_DIALECT_ID,
      supportsQueryPlan: true,
      ConnectionForm: SqlServerConnectionForm,
      subtitle: sqlServerSubtitle,
      validate: validateSqlServer
    });

    context.whenExpressions.registerTemplates([
      {
        name: "SQLServer Database",
        description: "Match SQL files using SQL Server against a specific selected database",
        when: `activeFile.mimeType == 'application/sql' && ${SQLSERVER_FILE_DIALECT_WHEN} && activeFile.metadata.core.queryengine.jdbc?.database == 'OrderService'`
      }
    ]);

    context.symbolActions.registerTemplate({
      id: "core.queryengine.jdbc.symbolAction.sqlserverDescribe",
      title: "SQLServer Describe",
      description: "Describe a table or view in SQL Server",
      order: 10,
      action: {
        label: "Describe",
        when: `activeFile.mimeType == 'application/sql' && ${SQLSERVER_FILE_DIALECT_WHEN} && (symbol.kind == 'table' || symbol.kind == 'view')`,
        query: "${symbol.attributes.database ? `exec ${fn.sqlserver.identifier(symbol.attributes.database)}.sys.sp_help ${fn.sql.literal(symbol.name)}` : `exec sp_help ${fn.sql.literal(symbol.name)}`}"
      }
    });

    context.jdbcTreeActions.registerTemplate({
      id: "core.queryengine.jdbc.treeAction.sqlserver.spHelptext",
      title: "SQL Server: Procedure Definition to Text",
      description: "Run sp_helptext and show results in text output",
      order: 10,
      action: {
        label: "Definition to Text",
        when: `${SQLSERVER_NODE_DIALECT_WHEN} && node.kind == 'procedure'`,
        query: "exec sp_helptext '${node.fullName}'",
        mode: "execute",
        outputTarget: "output",
        outputId: "core.queryengine.output.text"
      }
    });

    context.jdbcTreeActions.registerTemplate({
      id: "core.queryengine.jdbc.treeAction.sqlserver.spHelptextNewQuery",
      title: "SQL Server: Procedure Definition to New Query",
      description: "Run sp_helptext and open results in a new query file",
      order: 11,
      action: {
        label: "Definition to New Query",
        when: `${SQLSERVER_NODE_DIALECT_WHEN} && node.kind == 'procedure'`,
        query: "exec sp_helptext '${node.fullName}'",
        mode: "execute",
        outputTarget: "newQuery"
      }
    });

    context.jdbcTreeActions.registerTemplate({
      id: "core.queryengine.jdbc.treeAction.sqlserver.spHelp",
      title: "SQL Server: Object Help",
      description: "Run sp_help on database objects",
      order: 12,
      action: {
        label: "Help",
        when: `${SQLSERVER_NODE_DIALECT_WHEN} && (node.kind == 'table' || node.kind == 'view' || node.kind == 'procedure')`,
        query: "exec sp_help '${node.fullName}'",
        mode: "execute",
        outputTarget: "output"
      }
    });

    context.jdbcTreeActions.registerTemplate({
      id: "core.queryengine.jdbc.treeAction.sqlserver.selectTop100",
      title: "SQL Server: Select Top 100 Rows",
      description: "Select top 100 rows from a table or view",
      order: 13,
      action: {
        label: "Select Top 100 Rows",
        when: `${SQLSERVER_NODE_DIALECT_WHEN} && (node.kind == 'table' || node.kind == 'view')`,
        query: "select top 100 * from ${node.fullName}",
        mode: "execute",
        outputTarget: "output"
      }
    });

    // SQL Server plan output setting
    context.settings.registerSettings({
      moduleId: "core.queryengine.jdbc",
      title: "SQL Databases",
      order: 32,
      settings: [
        {
          id: SQLSERVER_PLAN_OUTPUT_SETTING_ID,
          moduleId: "core.queryengine.jdbc",
          title: "SQL Server Plan XML Output",
          description: "Controls whether SQL Server query plan XML result sets are also shown as raw query output when plan graph artifacts are produced.",
          sectionPath: ["Query Engine", "SQL Databases", "SQL Server"],
          tags: ["jdbc", "sqlserver", "plan", "showplan"],
          type: "enum",
          defaultValue: "suppress",
          options: [
            { label: "Suppress raw XML", value: "suppress" },
            { label: "Include raw XML", value: "include" }
          ]
        }
      ]
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }

    // Execution context provider: adds SQL Server's plan XML option to queries. The Actual Plan toggle itself is
    // handled by core.queryengine.jdbc for every dialect with `supportsQueryPlan`.
    context.queryEngines.registerExecutionContextProvider("jdbc", (params) => {
      if (!params.fileId) {
        return undefined;
      }

      const file = context.files.getFile(params.fileId);
      const isSqlServer = file?.metadata?.["core.queryengine.jdbc.dialectId"] === SQLSERVER_DIALECT_ID;
      if (!isSqlServer) {
        return undefined;
      }

      const rawXmlMode = getCoreSettingsService()?.getValue(SQLSERVER_PLAN_OUTPUT_SETTING_ID) === "include"
        ? "include"
        : "suppress";

      return {
        options: {
          ...params.options,
          dialectOptions: {
            ...(params.options?.dialectOptions ?? {}),
            sqlserverPlanXmlOutput: rawXmlMode
          }
        }
      };
    });
  }
};

/** `host[:port][/database]`, as stored: the connections list showed it this way before dialects described their own. */
export function sqlServerSubtitle(properties: Record<string, unknown>): string {
  const host = String(properties.host ?? "").trim();
  if (!host) {
    return "Host required";
  }
  const port = String(properties.port ?? "").trim();
  const database = String(properties.database ?? "").trim();
  const base = port ? `${host}:${port}` : host;
  return database ? `${base}/${database}` : base;
}

/** A host is required; a database only once the field was touched and left empty. */
export function validateSqlServer(properties: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (!String(properties.host ?? "").trim()) {
    problems.push("Host is required");
  }
  if ("database" in properties && !String(properties.database ?? "").trim()) {
    problems.push("Database is required");
  }
  return problems;
}
