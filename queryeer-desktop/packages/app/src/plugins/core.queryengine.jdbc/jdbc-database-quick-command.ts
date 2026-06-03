import type { QuickCommandItem, QuickCommandProvider } from "@queryeer/api/extensions/QuickCommandExtension";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { getJdbcDatabaseCache } from "./jdbc-database-cache";
import { writeJdbcContextMetadata } from "./jdbc-metadata";

const DATABASE_LOAD_TIMEOUT_MS = 500;

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
      // wait briefly for the local schema cache, but do not let H2/cache
      // contention make opening the command palette feel stuck.
      const results = await Promise.all(
        connections.map(async (conn) => {
          // Instant hit?
          const cached = cache.get(conn.connectionId);
          if (cached !== undefined) {
            return { connectionId: conn.connectionId, title: conn.title ?? conn.connectionId, databases: cached };
          }
          // Race load against a short timeout. The cache load continues in the
          // background and will be used the next time items are resolved.
          const databases = await Promise.race([
            cache.load(conn.connectionId).then((loaded) => loaded as string[] | null),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), DATABASE_LOAD_TIMEOUT_MS))
          ]);
          return { connectionId: conn.connectionId, title: conn.title ?? conn.connectionId, databases };
        })
      );

      const items: QuickCommandItem[] = [];
      for (const result of results) {
        if (result.databases === null) {
          continue;
        }
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
