import { getQueryEngineService } from "../core.queryengine/QueryEngineService";

export function prewarmJdbcTopSchema(connectionId: string): void {
  if (!connectionId) return;
  void Promise.resolve(getQueryEngineService().invoke(
    {
      engineId: "jdbc",
      action: "jdbc.schema.refresh",
      payload: { connectionId, scope: "top", mode: "due", waitForCompletion: false }
    },
    { silent: true }
  )).catch(() => {});
}

export function prewarmJdbcDatabaseSchema(connectionId: string, database: string): void {
  if (!connectionId || !database) return;
  void Promise.resolve(getQueryEngineService().invoke(
    {
      engineId: "jdbc",
      action: "jdbc.schema.refresh",
      payload: {
        connectionId,
        scope: "deep",
        target: { database },
        mode: "due",
        waitForCompletion: false
      }
    },
    { silent: true }
  )).catch(() => {});
}
