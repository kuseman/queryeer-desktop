import type { QuickCommandItem, QuickCommandProvider } from "../../contracts/extensions/QuickCommandExtension";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { getJdbcDatabaseCache } from "./jdbc-database-cache";

export function createJdbcDatabaseQuickCommandProvider(
  context: Pick<PluginContext, "fileMediator" | "files">
): QuickCommandProvider {
  return {
    prefix: "$",
    label: "Select Database",
    order: 15,
    when: "activeFileMimeType == 'application/sql'",
    async getItems(_query, ctx) {
      const activeFile = ctx.activeFile;
      if (!activeFile) {
        return [];
      }

      const connections = getConfiguredJdbcConnections().filter((c) => c.enabled);
      if (connections.length === 0) {
        return [];
      }

      const cache = getJdbcDatabaseCache();

      const results = await Promise.all(
        connections.map(async (conn) => {
          const databases = await cache.load(conn.connectionId);
          return { connectionId: conn.connectionId, title: conn.title ?? conn.connectionId, databases };
        })
      );

      const items: QuickCommandItem[] = [];
      for (const result of results) {
        if (result.databases.length === 0) {
          items.push({
            id: `jdbc.db.${result.connectionId}::`,
            title: `${result.title} / — no databases —`,
            description: "Select connection only",
            action: async () => {
              await context.fileMediator.bindEngine(activeFile.fileId, "jdbc", result.connectionId);
              context.files.setEditorState(activeFile.fileId, JDBC_NAV_DB_KEY, undefined);
            }
          });
          continue;
        }
        for (const db of result.databases) {
          items.push({
            id: `jdbc.db.${result.connectionId}::${db}`,
            title: `${result.title} / ${db}`,
            action: async () => {
              await context.fileMediator.bindEngine(activeFile.fileId, "jdbc", result.connectionId);
              context.files.setEditorState(activeFile.fileId, JDBC_NAV_DB_KEY, {
                connectionId: result.connectionId,
                database: db
              } satisfies JdbcSelectedDatabase);
            }
          });
        }
      }

      return items;
    }
  };
}
