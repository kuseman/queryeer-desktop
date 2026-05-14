import { useCallback, useEffect, useRef, useState } from "react";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import { getBackendStatusService } from "../../renderer/shell/backend-status-service";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { writeJdbcContextMetadata } from "./jdbc-metadata";
import { getJdbcDatabaseCache } from "./jdbc-database-cache";

function readSelectedDatabase(
  filesRegistry: FilesRegistry,
  fileId: string
): JdbcSelectedDatabase | undefined {
  const raw = filesRegistry.getEditorState(fileId, JDBC_NAV_DB_KEY);
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).connectionId === "string" &&
    typeof (raw as Record<string, unknown>).database === "string"
  ) {
    return raw as JdbcSelectedDatabase;
  }
  return undefined;
}

type Props = {
  fileId: string;
  fileMediator: FileMediator;
  filesRegistry: FilesRegistry;
};

export function JdbcConnectionSelector({ fileId, fileMediator, filesRegistry }: Props) {
  const file = filesRegistry.getFile(fileId);
  const [connectionId, setConnectionId] = useState<string>(
    file?.engineBinding?.connectionId ?? ""
  );
  const [selectedDatabase, setSelectedDatabase] = useState<string>(
    readSelectedDatabase(filesRegistry, fileId)?.database ?? ""
  );
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const prevBackendStateRef = useRef<string | null>(null);

  const loadDatabases = useCallback(
    async (connId: string, options?: { silent?: boolean }) => {
      if (!connId) {
        setDatabases([]);
        return;
      }
      const cache = getJdbcDatabaseCache();
      const cached = cache.get(connId);
      if (cached !== undefined && options?.silent) {
        setDatabases(cached);
        return;
      }
      setLoadingDatabases(true);
      try {
        const names = await cache.load(connId);
        setDatabases(names);
      } catch {
        setDatabases([]);
      } finally {
        setLoadingDatabases(false);
      }
    },
    []
  );

  // Sync context metadata on mount so restored workspace state is immediately visible.
  useEffect(() => {
    writeJdbcContextMetadata(fileId, connectionId || undefined, selectedDatabase || undefined, filesRegistry);
  }, []);

  // Load databases when connectionId changes (mount, file switch, external connection change)
  useEffect(() => {
    if (connectionId) {
      void loadDatabases(connectionId, { silent: true });
    } else {
      setDatabases([]);
    }
  }, [connectionId, loadDatabases]);

  // Re-sync with file entity when it changes externally
  useEffect(() => {
    return filesRegistry.subscribe((files) => {
      const updated = files.find((f) => f.fileId === fileId);
      if (updated) {
        const newConnId = updated.engineBinding?.connectionId ?? "";
        setConnectionId(newConnId);
        const persisted = readSelectedDatabase(filesRegistry, fileId);
        setSelectedDatabase(persisted?.database ?? "");
      }
    });
  }, [filesRegistry, fileId]);

  // Auto-recover: reload databases when backend becomes healthy
  useEffect(() => {
    const service = getBackendStatusService();
    return service.subscribe((status) => {
      if (status.state === "healthy" && prevBackendStateRef.current !== "healthy" && connectionId) {
        getJdbcDatabaseCache().invalidate(connectionId);
        void loadDatabases(connectionId, { silent: true });
      }
      prevBackendStateRef.current = status.state;
    });
  }, [connectionId, loadDatabases]);

  const handleConnectionChange = async (newConnId: string) => {
    setConnectionId(newConnId);
    setSelectedDatabase("");
    setDatabases([]);
    filesRegistry.setEditorState(fileId, JDBC_NAV_DB_KEY, undefined);
    await fileMediator.bindEngine(fileId, "jdbc", newConnId || undefined);
    writeJdbcContextMetadata(fileId, newConnId || undefined, undefined, filesRegistry);
    if (newConnId) {
      await loadDatabases(newConnId);
    }
  };

  const handleDatabaseChange = (db: string) => {
    setSelectedDatabase(db);
    const currentConnId = connectionId;
    if (currentConnId && db) {
      filesRegistry.setEditorState(fileId, JDBC_NAV_DB_KEY, {
        connectionId: currentConnId,
        database: db
      } satisfies JdbcSelectedDatabase);
      writeJdbcContextMetadata(fileId, currentConnId, db, filesRegistry);
    } else {
      filesRegistry.setEditorState(fileId, JDBC_NAV_DB_KEY, undefined);
      writeJdbcContextMetadata(fileId, currentConnId || undefined, undefined, filesRegistry);
    }
  };

  const configuredConnections = getConfiguredJdbcConnections().filter((c) => c.enabled);

  return (
    <div className="jdbc-nav-selector">
      <div className="jdbc-nav-selector-row">
        <label className="jdbc-nav-selector-label">Connection</label>
        <select
          data-testid="jdbc-connection-select"
          className="jdbc-nav-selector-select"
          value={connectionId}
          onChange={(e) => void handleConnectionChange(e.target.value)}
        >
          <option value="">— none —</option>
          {configuredConnections.map((c) => (
            <option key={c.connectionId} value={c.connectionId}>
              {c.title ?? "Untitled connection"}
            </option>
          ))}
        </select>
      </div>
      <div className="jdbc-nav-selector-row">
        <label className="jdbc-nav-selector-label">Database</label>
        {loadingDatabases ? (
          <span data-testid="jdbc-db-loading" className="jdbc-nav-selector-loading">
            loading…
          </span>
        ) : (
          <select
            data-testid="jdbc-database-select"
            className="jdbc-nav-selector-select"
            value={selectedDatabase}
            onChange={(e) => handleDatabaseChange(e.target.value)}
            disabled={databases.length === 0}
          >
            <option value="">— none —</option>
            {databases.map((db) => (
              <option key={db} value={db}>
                {db}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
