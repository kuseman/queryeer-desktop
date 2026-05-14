import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import type { JdbcSchemaObject } from "./jdbc-navigation-types";

const TTL_MS = 30_000;
const FAIL_COOLDOWN_MS = 60_000;

type CacheEntry = {
  databases: string[];
  fetchedAtMs: number;
};

class JdbcDatabaseCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly failures = new Map<string, number>(); // connectionId -> lastFailureAtMs
  private readonly inFlight = new Map<string, Promise<string[]>>();
  private readonly listeners = new Set<(connectionId: string, databases: string[]) => void>();

  get(connectionId: string): string[] | undefined {
    const entry = this.entries.get(connectionId);
    if (!entry) return undefined;
    if (Date.now() - entry.fetchedAtMs > TTL_MS) return undefined;
    return entry.databases;
  }

  /** Returns cached data if fresh, otherwise triggers background refresh and returns undefined.
   *  Unlike `load()`, this never blocks — callers that need instant results use this. */
  getCachedOrRefresh(connectionId: string): string[] | undefined {
    const cached = this.get(connectionId);
    if (cached !== undefined) return cached;
    // Trigger background refresh without awaiting
    this.load(connectionId).catch(() => {});
    return this.get(connectionId); // retry in case refresh completed synchronously
  }

  async load(connectionId: string): Promise<string[]> {
    const cached = this.get(connectionId);
    if (cached !== undefined) return cached;

    // Don't retry within cooldown after a failure
    const lastFailure = this.failures.get(connectionId);
    if (lastFailure !== undefined && Date.now() - lastFailure < FAIL_COOLDOWN_MS) {
      return [];
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
        { engineId: "jdbc", action: "jdbc.schema.snapshot", payload: { connectionId, scope: "top" } },
        { silent: true }
      )) as JdbcSchemaObject[];

      const databases = extractDatabaseNames(snapshot);

      this.entries.set(connectionId, { databases, fetchedAtMs: Date.now() });
      this.failures.delete(connectionId);
      this.notify(connectionId, databases);
      return databases;
    } catch {
      // Cache failure timestamp so retries return fast during cooldown
      this.failures.set(connectionId, Date.now());
      return [];
    } finally {
      this.inFlight.delete(connectionId);
    }
  }

  invalidate(connectionId?: string): void {
    if (connectionId) {
      this.entries.delete(connectionId);
      this.failures.delete(connectionId);
    } else {
      this.entries.clear();
      this.failures.clear();
    }
  }

  subscribe(listener: (connectionId: string, databases: string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(connectionId: string, databases: string[]): void {
    for (const listener of this.listeners) {
      listener(connectionId, databases);
    }
  }
}

function extractDatabaseNames(result: JdbcSchemaObject[]): string[] {
  const container = result.find((o) => o.kind === "databases_container");
  if (container?.children) {
    const dbNames = container.children.filter((o) => o.kind === "database").map((o) => o.name);
    if (dbNames.length > 0) return dbNames;
  }
  const dbNames = result.filter((o) => o.kind === "database").map((o) => o.name);
  if (dbNames.length > 0) return dbNames;
  return result.filter((o) => o.kind === "schema").map((o) => o.name);
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
