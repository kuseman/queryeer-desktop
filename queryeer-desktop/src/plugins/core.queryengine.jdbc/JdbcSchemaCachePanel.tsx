import { useCallback, useEffect, useMemo, useState } from "react";
import { getJdbcSchemaCacheStore } from "./jdbc-schema-cache-store";
import type { JdbcSchemaCrawlStatus } from "../../contracts/backend/Types";
import "./JdbcSchemaCachePanel.css";

type RowData = {
  connectionId: string;
  connectionTitle: string;
  scope: "top" | "deep";
  databaseKey: string | null;
  objectCount: number;
  lastSuccessAt: string | null;
  nextDueAt: string | null;
  consecutiveFailures: number;
  usageScore: number;
  enabled: boolean;
  lastError: string | null;
};

export function JdbcSchemaCachePanel() {
  const [entries, setEntries] = useState<JdbcSchemaCrawlStatus[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);

  useEffect(() => {
    void getJdbcSchemaCacheStore().load();
    return getJdbcSchemaCacheStore().subscribe((state) => {
      setEntries(state.entries);
      setIsLoading(state.isLoading);
      setError(state.error);
    });
  }, []);

  const handleRefreshAll = useCallback(async () => {
    setIsLoading(true);
    await getJdbcSchemaCacheStore().load();
  }, []);

  const handleRefreshRow = useCallback(async (connectionId: string, scope: "top" | "deep", databaseKey?: string) => {
    const key = `${connectionId}:${scope}:${databaseKey ?? ""}`;
    setRefreshingKey(key);
    try {
      await getJdbcSchemaCacheStore().forceRefresh(connectionId, scope, databaseKey);
    } finally {
      setRefreshingKey(null);
    }
  }, []);

  const handleToggleEnabled = useCallback(async (_connectionId: string, _scope: "top" | "deep", _databaseKey: string | null, _currentEnabled: boolean) => {
    // TODO: Implement toggle via backend action when available
    await getJdbcSchemaCacheStore().load();
  }, []);

  const rows = useMemo<RowData[]>(() => {
    return entries.map((entry) => ({
      connectionId: entry.connectionId,
      connectionTitle: entry.connectionTitle,
      scope: entry.scope,
      databaseKey: entry.databaseKey,
      objectCount: entry.objectCount,
      lastSuccessAt: entry.lastSuccessAt,
      nextDueAt: entry.nextDueAt,
      consecutiveFailures: entry.consecutiveFailures,
      usageScore: entry.usageScore,
      enabled: entry.enabled,
      lastError: entry.lastError
    }));
  }, [entries]);

  const groupedRows = useMemo(() => {
    const groups = new Map<string, RowData[]>();
    for (const row of rows) {
      const existing = groups.get(row.connectionId) ?? [];
      existing.push(row);
      groups.set(row.connectionId, existing);
    }
    return groups;
  }, [rows]);

  if (isLoading && rows.length === 0) {
    return (
      <div className="schema-cache-panel">
        <div className="schema-cache-panel__loading">Loading schema cache status...</div>
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div className="schema-cache-panel">
        <div className="schema-cache-panel__error">{error}</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="schema-cache-panel">
        <div className="schema-cache-panel__empty">No schema cache data. Configure JDBC connections to see crawl status.</div>
      </div>
    );
  }

  return (
    <div className="schema-cache-panel">
      <div className="schema-cache-panel__header">
        <span className="schema-cache-panel__title">Schema Cache</span>
        <button
          type="button"
          className="schema-cache-panel__refresh-btn"
          onClick={handleRefreshAll}
          disabled={isLoading}
          title="Refresh all"
        >
          {isLoading ? "Loading..." : "↻ Refresh"}
        </button>
      </div>
      <table className="schema-cache-panel__table">
        <thead>
          <tr>
            <th>Connection</th>
            <th>Scope</th>
            <th>Database</th>
            <th>Objects</th>
            <th>Last Success</th>
            <th>Next Due</th>
            <th>Failures</th>
            <th>Usage</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {[...groupedRows.entries()].map(([connectionId, groupRows]) => (
            <ConnectionGroup
              key={connectionId}
              connectionId={connectionId}
              rows={groupRows}
              refreshingKey={refreshingKey}
              onRefreshRow={handleRefreshRow}
              onToggleEnabled={handleToggleEnabled}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type ConnectionGroupProps = {
  connectionId: string;
  rows: RowData[];
  refreshingKey: string | null;
  onRefreshRow: (connectionId: string, scope: "top" | "deep", databaseKey?: string) => void;
  onToggleEnabled: (connectionId: string, scope: "top" | "deep", databaseKey: string | null, enabled: boolean) => void;
};

function ConnectionGroup({ connectionId, rows, refreshingKey, onRefreshRow, onToggleEnabled: _onToggleEnabled }: ConnectionGroupProps) {
  const connectionTitle = rows[0]?.connectionTitle ?? connectionId;

  return (
    <>
      {rows.map((row, index) => {
        const rowKey = `${row.connectionId}:${row.scope}:${row.databaseKey ?? ""}`;
        const isRefreshing = refreshingKey === rowKey;
        const usageLevel = row.usageScore >= 0.8 ? "hot" : row.usageScore >= 0.5 ? "warm" : "cold";
        const lastSuccessStr = row.lastSuccessAt ? formatTimestamp(row.lastSuccessAt) : "-";
        const nextDueStr = row.nextDueAt ? formatTimestamp(row.nextDueAt) : "-";

        return (
          <tr key={rowKey}>
            <td className="schema-cache-panel__connection">
              {index === 0 ? connectionTitle : ""}
            </td>
            <td>
              <span className="schema-cache-panel__scope">{row.scope}</span>
            </td>
            <td>{row.databaseKey ?? "-"}</td>
            <td>{row.objectCount.toLocaleString()}</td>
            <td className="schema-cache-panel__timestamp">{lastSuccessStr}</td>
            <td className="schema-cache-panel__timestamp">{nextDueStr}</td>
            <td className={row.consecutiveFailures > 2 ? "schema-cache-panel__failures--high" : "schema-cache-panel__failures"}>
              {row.consecutiveFailures > 0 ? row.consecutiveFailures : "-"}
            </td>
            <td>
              <span className={`schema-cache-panel__usage schema-cache-panel__usage--${usageLevel}`} />
              {usageLevel}
            </td>
            <td>
              <div className="schema-cache-panel__actions">
                <button
                  type="button"
                  className="schema-cache-panel__action-btn"
                  onClick={() => onRefreshRow(row.connectionId, row.scope, row.databaseKey ?? undefined)}
                  disabled={isRefreshing}
                  title="Force refresh"
                >
                  {isRefreshing ? "..." : "Refresh"}
                </button>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "-";
    return date.toISOString()
  } catch {
    return "-";
  }
}
