import type { QuickCommandItem, QuickCommandProvider } from "../../contracts/extensions/QuickCommandExtension";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { getJdbcDatabaseCache } from "./jdbc-database-cache";
import { writeJdbcContextMetadata } from "./jdbc-metadata";

export function createJdbcDatabaseQuickCommandProvider(
  context: Pick<PluginContext, "fileMediator" | "files" | "editors">
): QuickCommandProvider {
  const refocusActiveEditor = () => {
    setTimeout(() => {
      context.editors.getActiveEditor()?.focus?.focus();
    }, 0);
  };

  return {
    prefix: "$",
    label: "Select Database",
    order: 15,
    when: "activeFile.mimeType == 'application/sql'",
    async getItems(_query, ctx) {
      const activeFile = ctx.activeFile;
      if (!activeFile) return [];

      const connections = getConfiguredJdbcConnections().filter((c) => c.enabled);
      if (connections.length === 0) return [];

      const cache = getJdbcDatabaseCache();

      // Use cached data first (instant). For connections without fresh data,
      // trigger load with a short timeout — broken connections fail fast after
      // the first attempt (60s failure cooldown in the cache).
      const results = await Promise.all(
        connections.map(async (conn) => {
          // Instant hit?
          const cached = cache.get(conn.connectionId);
          if (cached !== undefined) {
            return { connectionId: conn.connectionId, title: conn.title ?? conn.connectionId, databases: cached };
          }
          // Race load against 5s timeout to avoid blocking on unreachable servers
          const databases = await Promise.race([
            cache.load(conn.connectionId),
            new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 5000))
          ]);
          return { connectionId: conn.connectionId, title: conn.title ?? conn.connectionId, databases };
        })
      );

      const items: QuickCommandItem[] = [];
      for (const result of results) {
        const connColor = connections.find((c) => c.connectionId === result.connectionId)?.color;
        if (result.databases.length === 0) {
          items.push({
            id: `jdbc.db.${result.connectionId}::`,
            title: `${result.title} / — no databases —`,
            titleParts: [
              { text: `${result.title} / `, color: connColor },
              { text: "— no databases —" }
            ],
            description: "Select connection only",
            action: async () => {
              context.files.setEditorState(activeFile.fileId, JDBC_NAV_DB_KEY, undefined);
              await context.fileMediator.bindEngine(activeFile.fileId, "jdbc", result.connectionId);
              writeJdbcContextMetadata(activeFile.fileId, result.connectionId, undefined, context.files);
              refocusActiveEditor();
            }
          });
          continue;
        }
        for (const db of result.databases) {
          items.push({
            id: `jdbc.db.${result.connectionId}::${db}`,
            title: `${result.title} / ${db}`,
            titleParts: [
              { text: `${result.title} / `, color: connColor },
              { text: db }
            ],
            action: async () => {
              context.files.setEditorState(activeFile.fileId, JDBC_NAV_DB_KEY, {
                connectionId: result.connectionId,
                database: db
              } satisfies JdbcSelectedDatabase);
              await context.fileMediator.bindEngine(activeFile.fileId, "jdbc", result.connectionId);
              writeJdbcContextMetadata(activeFile.fileId, result.connectionId, db, context.files);
              refocusActiveEditor();
            }
          });
        }
      }

      return items;
    }
  };
}
