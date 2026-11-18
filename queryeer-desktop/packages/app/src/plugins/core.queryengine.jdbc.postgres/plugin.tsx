import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getQueryViewStateStore } from "../core.queryengine/QueryViewStateStore";

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
    context.jdbcDrivers.registerDriver({
      dialectId: POSTGRES_DIALECT_ID,
      displayName: "PostgreSQL JDBC Driver",
      groupId: "org.postgresql",
      artifactId: "postgresql",
      driverClassName: "org.postgresql.Driver",
      downloadPageUrl: "https://jdbc.postgresql.org/download/"
    });

    // The connection form is rendered from the backend dialect's fields (PostgresConnectionSetup)
    context.jdbcDialects.registerDialect({
      dialectId: POSTGRES_DIALECT_ID,
      supportsQueryPlan: true
    });

    context.whenExpressions.registerTemplates([
      {
        name: "PostgreSQL Database",
        description: "Match SQL files using PostgreSQL against a specific selected database",
        when: `activeFile.mimeType == 'application/sql' && ${POSTGRES_FILE_DIALECT_WHEN} && activeFile.metadata.core.queryengine.jdbc?.database == 'postgres'`
      }
    ]);

    context.symbolActions.registerTemplate({
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

    context.jdbcTreeActions.registerTemplate({
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
    context.queryEngines.registerExecutionContextProvider("jdbc", (params) => {
      if (!params.fileId) {
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
