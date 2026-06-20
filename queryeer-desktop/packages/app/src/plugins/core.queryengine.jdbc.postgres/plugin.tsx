import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getQueryViewStateStore } from "../core.queryengine/QueryViewStateStore";
import { registerJdbcDialect } from "../core.queryengine.jdbc/jdbc-dialect-registry";
import { registerWhenExpressionTemplates } from "../core.commands/when-expression-template-registry";
import { registerSymbolActionTemplate } from "../core.queryengine/symbol-action-template-registry";
import { registerTreeActionTemplate } from "../core.queryengine.jdbc/tree-action-template-registry";
import { PostgresConnectionForm } from "./PostgresConnectionForm";

const POSTGRES_DIALECT_ID = "postgres";
const POSTGRES_FILE_DIALECT_WHEN = `activeFile.metadata.core.queryengine.jdbc?.dialectId == '${POSTGRES_DIALECT_ID}'`;
const POSTGRES_NODE_DIALECT_WHEN = `node.dialectId == '${POSTGRES_DIALECT_ID}'`;

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
        query: "SELECT column_name, data_type, is_nullable, ordinal_position FROM information_schema.columns WHERE table_schema = '${symbol.attributes.schema}' AND table_name = '${symbol.attributes.name || symbol.name}' ORDER BY ordinal_position"
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

      const viewState = getQueryViewStateStore().read(params.fileId, params.targetOutputSessionId ?? params.fileId);
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
