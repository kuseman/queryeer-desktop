import { getQueryEngineService } from "../core.queryengine/QueryEngineService";

const JDBC_CONNECTION_SESSIONS_ACTION = "jdbc.connection.sessions";

export type JdbcConnectionSessionSnapshot = {
  fileId: string;
  connectionId: string;
  sessionId?: string;
  lastAccessTimeMs?: number;
  status?: "alive" | "dead";
};

type JdbcSessionSnapshotState = {
  entries: JdbcConnectionSessionSnapshot[];
  updatedAtMs: number;
};

class JdbcSessionStore {
  private readonly listeners = new Set<(state: JdbcSessionSnapshotState) => void>();
  private started = false;
  private state: JdbcSessionSnapshotState = { entries: [], updatedAtMs: 0 };

  startPolling(intervalMs = 5000): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.refresh();
    window.setInterval(() => {
      void this.refresh();
    }, intervalMs);
  }

  subscribe(listener: (state: JdbcSessionSnapshotState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): JdbcSessionSnapshotState {
    return this.state;
  }

  private async refresh(): Promise<void> {
    try {
      const result = await getQueryEngineService().invoke(
        { engineId: "jdbc", action: JDBC_CONNECTION_SESSIONS_ACTION },
        { silent: true }
      );
      const entries = Array.isArray(result)
        ? result.filter((entry): entry is JdbcConnectionSessionSnapshot => {
            return (
              entry !== null &&
              typeof entry === "object" &&
              !Array.isArray(entry) &&
              typeof (entry as { fileId?: unknown }).fileId === "string" &&
              typeof (entry as { connectionId?: unknown }).connectionId === "string"
            );
          })
        : [];
      this.state = {
        entries,
        updatedAtMs: Date.now()
      };
      for (const listener of this.listeners) {
        listener(this.state);
      }
    } catch {
      // best effort polling
    }
  }
}

let sessionStoreInstance: JdbcSessionStore | undefined;

export function getJdbcSessionStore(): JdbcSessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new JdbcSessionStore();
  }
  return sessionStoreInstance;
}
