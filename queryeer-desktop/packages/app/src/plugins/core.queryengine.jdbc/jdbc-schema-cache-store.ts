import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import type { JdbcSchemaCrawlStatus } from "@queryeer/api/backend/Types";

const JDBC_SCHEMA_STATUS_ACTION = "jdbc.schema.status";

type JdbcSchemaCacheState = {
  entries: JdbcSchemaCrawlStatus[];
  isLoading: boolean;
  lastLoadedAtMs: number;
  error: string | null;
};

class JdbcSchemaCacheStore {
  private readonly listeners = new Set<(state: JdbcSchemaCacheState) => void>();
  private state: JdbcSchemaCacheState = { entries: [], isLoading: false, lastLoadedAtMs: 0, error: null };

  async load(connectionId?: string): Promise<void> {
    this.state = { ...this.state, isLoading: true, error: null };
    this.notify();

    try {
      const result = await getQueryEngineService().invoke(
        { engineId: "jdbc", action: JDBC_SCHEMA_STATUS_ACTION, payload: connectionId ? { connectionId } : undefined },
        { silent: true }
      );
      const entries = Array.isArray(result)
        ? result.filter((entry): entry is JdbcSchemaCrawlStatus => {
            return (
              entry !== null &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              typeof (entry as { connectionId?: unknown }).connectionId === "string" &&
              typeof (entry as { scope?: unknown }).scope === "string"
            );
          })
        : [];
      this.state = {
        entries,
        isLoading: false,
        lastLoadedAtMs: Date.now(),
        error: null
      };
    } catch (e) {
      this.state = {
        entries: [],
        isLoading: false,
        lastLoadedAtMs: this.state.lastLoadedAtMs,
        error: e instanceof Error ? e.message : String(e)
      };
    }
    this.notify();
  }

  async forceRefresh(connectionId: string, scope: "top" | "deep", databaseKey?: string): Promise<void> {
    const payload: Record<string, unknown> = {
      connectionId,
      scope,
      mode: "force",
      waitForCompletion: true
    };
    if (scope === "deep" && databaseKey) {
      payload.target = { database: databaseKey };
    }
    await getQueryEngineService().invoke(
      { engineId: "jdbc", action: "jdbc.schema.refresh", payload },
      { silent: false }
    );
    await this.load();
  }

  getState(): JdbcSchemaCacheState {
    return this.state;
  }

  subscribe(listener: (state: JdbcSchemaCacheState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

let instance: JdbcSchemaCacheStore | undefined;

export function getJdbcSchemaCacheStore(): JdbcSchemaCacheStore {
  if (!instance) {
    instance = new JdbcSchemaCacheStore();
  }
  return instance;
}
