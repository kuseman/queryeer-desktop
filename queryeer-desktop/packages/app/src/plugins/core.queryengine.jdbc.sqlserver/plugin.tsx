import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getQueryViewStateStore } from "../core.queryengine/QueryViewStateStore";
import { getCoreSettingsService } from "../core.settings/service";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";
import { registerWhenExpressionTemplates } from "../core.commands/when-expression-template-registry";
import { registerSymbolActionTemplate } from "../core.queryengine/symbol-action-template-registry";
import { registerTreeActionTemplate } from "../core.queryengine.jdbc/tree-action-template-registry";
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
    registerSqlServerExpressionFunctions();

    // Register connection form for the JDBC settings editor
    registerJdbcDialect({
      dialectId: SQLSERVER_DIALECT_ID,
      supportsQueryPlan: true,
      ConnectionForm: SqlServerConnectionForm
    });

    registerWhenExpressionTemplates([
      {
        name: "SQLServer Database",
        description: "Match SQL files using SQL Server against a specific selected database",
        when: `activeFile.mimeType == 'application/sql' && ${SQLSERVER_FILE_DIALECT_WHEN} && activeFile.metadata.core.queryengine.jdbc?.database == 'OrderService'`
      }
    ]);

    registerSymbolActionTemplate({
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

    registerTreeActionTemplate({
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

    registerTreeActionTemplate({
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

    registerTreeActionTemplate({
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

    registerTreeActionTemplate({
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
      title: "Query Engine JDBC",
      order: 32,
      settings: [
        {
          id: SQLSERVER_PLAN_OUTPUT_SETTING_ID,
          moduleId: "core.queryengine.jdbc",
          title: "SQL Server Plan XML Output",
          description: "Controls whether SQL Server query plan XML result sets are also shown as raw query output when plan graph artifacts are produced.",
          sectionPath: ["Query Engine", "JDBC", "SQL Server"],
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

    // Execution context provider: adds SQL Server plan options to queries
    getQueryEngineService().registerExecutionContextProvider((params) => {
      if (params.engineId !== "jdbc" || !params.fileId) {
        return undefined;
      }

      const file = context.files.getFile(params.fileId);
      const isSqlServer = file?.metadata?.["core.queryengine.jdbc.dialectId"] === SQLSERVER_DIALECT_ID;
      if (!isSqlServer) {
        return undefined;
      }

      const viewState = getQueryViewStateStore().read(params.fileId, params.targetOutputSessionId ?? params.fileId);
      const includeActualPlan = viewState.includeActualPlan === true && !params.options?.intent;
      const rawXmlMode = getCoreSettingsService()?.getValue(SQLSERVER_PLAN_OUTPUT_SETTING_ID) === "include"
        ? "include"
        : "suppress";

      return {
        options: {
          ...params.options,
          intent: includeActualPlan ? "plan.actual" : params.options?.intent,
          requestedArtifacts: params.options?.requestedArtifacts ?? (includeActualPlan ? [{ capability: "plan", kind: "graph" }] : undefined),
          dialectOptions: {
            ...(params.options?.dialectOptions ?? {}),
            sqlserverPlanXmlOutput: rawXmlMode
          }
        }
      };
    });
  }
};
