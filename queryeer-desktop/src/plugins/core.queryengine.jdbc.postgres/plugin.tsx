import type { Plugin } from "../../contracts/plugin/Plugin";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { QUERY_PLAN_ARTIFACT_REQUEST, QUERY_PLAN_OUTPUT_ID as PLAN_OUTPUT_ID } from "../core.queryengine/query-plan/constants";
import { getQueryViewStateStore } from "../core.queryengine/QueryViewStateStore";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";
import { registerWhenExpressionTemplates } from "../core.commands/when-expression-template-registry";
import { registerSymbolActionTemplate } from "../core.queryengine/symbol-action-template-registry";
import { registerTreeActionTemplate } from "../core.queryengine.jdbc/tree-action-template-registry";
import { PostgresConnectionForm } from "./PostgresConnectionForm";

const POSTGRES_DIALECT_ID = "postgres";
const POSTGRES_FILE_DIALECT_WHEN = `activeFile.metadata.core.queryengine.jdbc?.dialectId == '${POSTGRES_DIALECT_ID}'`;
const POSTGRES_NODE_DIALECT_WHEN = `node.dialectId == '${POSTGRES_DIALECT_ID}'`;
const POSTGRES_WHEN = `hasActiveQueryExecutableFile && hasActiveQueryPlanDialect && activeFile?.metadata?.core?.queryengine?.jdbc?.dialectId == '${POSTGRES_DIALECT_ID}'`;

export const coreQueryEngineJdbcPostgresPlugin: Plugin = {
  manifest: {
    id: "core.queryengine.jdbc.postgres",
    name: "Core Query Engine JDBC PostgreSQL",
    version: "0.1.0",
    kind: "core",
    description: "PostgreSQL dialect support for JDBC connections",
    dependencies: ["core.queryengine", "core.queryengine.jdbc", "core.settings", "core.commands"],
    requiredCapabilities: ["query.engine"],
    providesCapabilities: ["query.engine.jdbc.postgres"]
  },
  activate: (context) => {
    registerJdbcDialect({
      dialectId: POSTGRES_DIALECT_ID,
      supportsQueryPlan: true,
      ConnectionForm: PostgresConnectionForm
    });

    registerWhenExpressionTemplates([
      {
        name: "PostgreSQL Database",
        description: "Match SQL files using PostgreSQL against a specific selected database",
        when: `activeFile.mimeType == 'application/sql' && ${POSTGRES_FILE_DIALECT_WHEN} && activeFile.metadata.core.queryengine.jdbc?.database == 'postgres'`
      }
    ]);

    registerSymbolActionTemplate({
      id: "core.queryengine.jdbc.symbolAction.postgresDescribe",
      title: "PostgreSQL Describe",
      description: "Describe a table or view in PostgreSQL",
      order: 10,
      action: {
        label: "Describe",
        when: `activeFile.mimeType == 'application/sql' && ${POSTGRES_FILE_DIALECT_WHEN} && (symbol.kind == 'table' || symbol.kind == 'view')`,
        query: "SELECT column_name, data_type, is_nullable, ordinal_position FROM information_schema.columns WHERE table_schema = '${symbol.attributes.schema}' AND table_name = '${symbol.name}' ORDER BY ordinal_position"
      }
    });

    registerTreeActionTemplate({
      id: "core.queryengine.jdbc.treeAction.postgres.selectTop100",
      title: "PostgreSQL: Select Top 100 Rows",
      description: "Select top 100 rows from a table or view",
      order: 13,
      action: {
        label: "Select Top 100 Rows",
        when: `${POSTGRES_NODE_DIALECT_WHEN} && (node.kind == 'table' || node.kind == 'view')`,
        query: "select * from ${node.fullName} limit 100",
        mode: "execute",
        outputTarget: "output"
      }
    });

    const getActiveQueryFile = () => {
      const fileId = context.fileMediator.getActiveFileId();
      return fileId ? context.files.getFile(fileId) : undefined;
    };

    // PostgreSQL plan commands
    context.commands.registerCommand({
      id: "core.queryengine.jdbc.postgres.showEstimatedPlan",
      title: "Show Estimated Query Plan",
      category: "Query",
      enablement: `backendHealthy && ${POSTGRES_WHEN}`,
      handler: async () => {
        getQueryEngineService().requestExecute({
          outputIdOverride: PLAN_OUTPUT_ID,
          optionsOverride: {
            intent: "plan.estimated",
            requestedArtifacts: QUERY_PLAN_ARTIFACT_REQUEST
          }
        });
      }
    });

    context.commands.registerCommand({
      id: "core.queryengine.jdbc.postgres.toggleActualPlan",
      title: "Include Actual Query Plan",
      category: "Query",
      enablement: POSTGRES_WHEN,
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

    // PostgreSQL toolbar actions
    context.layout.registerToolbarAction({
      id: "core.queryengine.jdbc.toolbar.postgres.showEstimatedPlan",
      title: "Estimated Plan",
      order: 44,
      commandId: "core.queryengine.jdbc.postgres.showEstimatedPlan",
      when: POSTGRES_WHEN
    });

    context.layout.registerToolbarAction({
      id: "core.queryengine.jdbc.toolbar.postgres.includeActualPlan",
      title: "Actual Plan",
      order: 45,
      commandId: "core.queryengine.jdbc.postgres.toggleActualPlan",
      when: POSTGRES_WHEN,
      pressed: () => {
        const file = getActiveQueryFile();
        return file ? getQueryViewStateStore().read(file.fileId).includeActualPlan === true : false;
      }
    });

    // Execution context provider: intercepts normal execute when Actual Plan toggle is on
    getQueryEngineService().registerExecutionContextProvider((params) => {
      if (params.engineId !== "jdbc" || !params.fileId) {
        return undefined;
      }

      const file = context.files.getFile(params.fileId);
      const isPostgres = file?.metadata?.["core.queryengine.jdbc.dialectId"] === POSTGRES_DIALECT_ID;
      if (!isPostgres) {
        return undefined;
      }

      const viewState = getQueryViewStateStore().read(params.fileId);
      const includeActualPlan = viewState.includeActualPlan === true && !params.options?.intent;

      return {
        options: {
          ...params.options,
          intent: includeActualPlan ? "plan.actual" : params.options?.intent,
          requestedArtifacts: params.options?.requestedArtifacts ?? (includeActualPlan ? [{ capability: "plan", kind: "graph" }] : undefined)
        }
      };
    });
  }
};
