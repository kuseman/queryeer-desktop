import type { Plugin } from "../../contracts/plugin/Plugin";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getQueryViewStateStore } from "../core.queryengine/QueryViewStateStore";
import { getCoreSettingsService } from "../core.settings/service";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";
import { registerWhenExpressionTemplates } from "../core.commands/when-expression-template-registry";
import { registerSymbolActionTemplate } from "../core.queryengine/symbol-action-template-registry";
import { registerTreeActionTemplate } from "../core.queryengine.jdbc/tree-action-template-registry";
import { SqlServerConnectionForm } from "./SqlServerConnectionForm";

const SQLSERVER_PLAN_OUTPUT_SETTING_ID = "core.queryengine.jdbc.sqlserver.planXmlOutput";
const PLAN_OUTPUT_ID = "core.graph.queryPlanOutput";
const SQLSERVER_WHEN = "hasActiveQueryExecutableFile && activeFile?.metadata?.core?.queryengine?.jdbc?.dialectId == 'sqlserver'";

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
    // Register connection form for the JDBC settings editor
    registerJdbcDialect({
      dialectId: "sqlserver",
      ConnectionForm: SqlServerConnectionForm
    });

    registerWhenExpressionTemplates([
      {
        name: "SQLServer Database",
        description: "Match SQL files using SQL Server against a specific selected database",
        when: "activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc?.dialectId == 'sqlserver' && activeFile.metadata.core.queryengine.jdbc?.database == 'OrderService'"
      }
    ]);

    registerSymbolActionTemplate({
      id: "core.queryengine.jdbc.symbolAction.sqlserverDescribe",
      title: "SQLServer Describe",
      description: "Describe a table or view in SQL Server",
      order: 10,
      action: {
        label: "Describe",
        when: "activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc?.dialectId == 'sqlserver' && (symbol.kind == 'table' || symbol.kind == 'view')",
        query: "exec sp_help '${symbol.name}'"
      }
    });

    registerTreeActionTemplate({
      id: "core.queryengine.jdbc.treeAction.sqlserver.spHelptext",
      title: "SQL Server: Procedure Definition to Text",
      description: "Run sp_helptext and show results in text output",
      order: 10,
      action: {
        label: "Definition to Text",
        when: "node.dialectId == 'sqlserver' && node.kind == 'procedure'",
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
        when: "node.dialectId == 'sqlserver' && node.kind == 'procedure'",
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
        when: "node.dialectId == 'sqlserver' && (node.kind == 'table' || node.kind == 'view' || node.kind == 'procedure')",
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
        when: "node.dialectId == 'sqlserver' && (node.kind == 'table' || node.kind == 'view')",
        query: "select top 100 * from ${node.fullName}",
        mode: "execute",
        outputTarget: "output"
      }
    });

    const getActiveQueryFile = () => {
      const fileId = context.fileMediator.getActiveFileId();
      return fileId ? context.files.getFile(fileId) : undefined;
    };

    // SQL Server plan commands
    context.commands.registerCommand({
      id: "core.queryengine.jdbc.sqlserver.showEstimatedPlan",
      title: "Show Estimated Query Plan",
      category: "Query",
      enablement: `backendHealthy && ${SQLSERVER_WHEN}`,
      handler: async () => {
        getQueryEngineService().requestExecute({
          outputIdOverride: PLAN_OUTPUT_ID,
          optionsOverride: {
            intent: "plan.estimated",
            requestedArtifacts: [{ capability: "plan", kind: "graph" }]
          }
        });
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.jdbc.sqlserver.toggleActualPlan",
      title: "Include Actual Query Plan",
      category: "Query",
      enablement: SQLSERVER_WHEN,
      handler: async () => {
        const file = getActiveQueryFile();
        if (!file) {
          return;
        }
        const store = getQueryViewStateStore();
        const current = store.read(file.fileId).includeActualPlan === true;
        store.setIncludeActualPlan(file.fileId, !current);
      }
    });

    // SQL Server toolbar actions
    context.layout.registerToolbarAction({
      id: "core.queryengine.jdbc.toolbar.sqlserver.showEstimatedPlan",
      title: "Estimated Plan",
      order: 44,
      commandId: "core.queryengine.jdbc.sqlserver.showEstimatedPlan",
      when: SQLSERVER_WHEN
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.jdbc.toolbar.sqlserver.includeActualPlan",
      title: "Actual Plan",
      order: 45,
      commandId: "core.queryengine.jdbc.sqlserver.toggleActualPlan",
      when: SQLSERVER_WHEN,
      pressed: () => {
        const file = getActiveQueryFile();
        return file ? getQueryViewStateStore().read(file.fileId).includeActualPlan === true : false;
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
      const isSqlServer = file?.metadata?.["core.queryengine.jdbc.dialectId"] === "sqlserver";
      if (!isSqlServer) {
        return undefined;
      }

      const viewState = getQueryViewStateStore().read(params.fileId);
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
