import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import type { JdbcSchemaObject } from "./jdbc-navigation-types";

const TTL_MS = 30_000;

type CacheEntry = {
  databases: string[];
  fetchedAtMs: number;
};

class JdbcDatabaseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string[]>>();
  private readonly listeners = new Set<(connectionId: string, databases: string[]) => void>();

  get(connectionId: string): string[] | undefined {
    const entry = this.entries.get(connectionId);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.fetchedAtMs > TTL_MS) {
      return undefined;
    }
    return entry.databases;
  }

  async load(connectionId: string): Promise<string[]> {
    const cached = this.get(connectionId);
    if (cached !== undefined) {
      return cached;
    }

    let promise = this.inFlight.get(connectionId);
    if (!promise) {
      promise = this.fetchAndStore(connectionId);
      this.inFlight.set(connectionId, promise);
    }
    return promise;
  }

  private async fetchAndStore(connectionId: string): Promise<string[]> {
    try {
      const snapshot = (await getQueryEngineService().invoke(
        {
          engineId: "jdbc",
          action: "jdbc.schema.snapshot",
          payload: { connectionId, scope: "top" }
        },
        { silent: true }
      )) as JdbcSchemaObject[];

      let databases = extractDatabaseNames(snapshot);
      if (databases.length === 0) {
        const live = (await getQueryEngineService().invoke(
          {
            engineId: "jdbc",
            action: "jdbc.schema.fetch",
            payload: { connectionId, scope: "top" }
          },
          { silent: true }
        )) as JdbcSchemaObject[];
        databases = extractDatabaseNames(live);
      }

      this.entries.set(connectionId, { databases, fetchedAtMs: Date.now() });
      this.notify(connectionId, databases);
      return databases;
    } catch {
      return [];
    } finally {
      this.inFlight.delete(connectionId);
    }
  }

  invalidate(connectionId?: string): void {
    if (connectionId) {
      this.entries.delete(connectionId);
    } else {
      this.entries.clear();
    }
  }

  subscribe(listener: (connectionId: string, databases: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(connectionId: string, databases: string[]): void {
    for (const listener of this.listeners) {
      listener(connectionId, databases);
    }
  }
}

function extractDatabaseNames(result: JdbcSchemaObject[]): string[] {
  const dbNames = result.filter((o) => o.kind === "database").map((o) => o.name);
  return dbNames.length > 0 ? dbNames : result.filter((o) => o.kind === "schema").map((o) => o.name);
}

let instance: JdbcDatabaseCache | undefined;

export function getJdbcDatabaseCache(): JdbcDatabaseCache {
  if (!instance) {
    instance = new JdbcDatabaseCache();
  }
  return instance;
}

export function resetJdbcDatabaseCacheForTests(): void {
  instance = undefined;
}
