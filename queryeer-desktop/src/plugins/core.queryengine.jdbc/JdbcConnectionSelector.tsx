import { useCallback, useEffect, useRef, useState } from "react";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getBackendStatusService } from "../../renderer/shell/backend-status-service";
import { JDBC_NAV_DB_KEY, type JdbcSchemaObject, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { getConfiguredJdbcConnections } from "./jdbc-settings";

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
      setLoadingDatabases(true);
      try {
        const result = (await getQueryEngineService().invoke({
          engineId: "jdbc",
          action: "jdbc.schema.fetch",
          payload: { connectionId: connId, scope: "top" }
        }, { silent: options?.silent })) as JdbcSchemaObject[];
        const dbNames = result
          .filter((o) => o.kind === "database")
          .map((o) => o.name);
        const names =
          dbNames.length > 0
            ? dbNames
            : result.filter((o) => o.kind === "schema").map((o) => o.name);
        setDatabases(names);
      } catch {
        setDatabases([]);
      } finally {
        setLoadingDatabases(false);
      }
    },
    []
  );

  // Load databases on mount when connection is already set
  useEffect(() => {
    if (connectionId) {
      void loadDatabases(connectionId);
    }
  }, []);

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
        void loadDatabases(connectionId, { silent: true });
      }
      prevBackendStateRef.current = status.state;
    });
  }, [connectionId, loadDatabases]);

  const handleConnectionChange = async (newConnId: string) => {
    setConnectionId(newConnId);
    setSelectedDatabase("");
    setDatabases([]);
    await fileMediator.bindEngine(fileId, "jdbc", newConnId || undefined);
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
    } else {
      filesRegistry.setEditorState(fileId, JDBC_NAV_DB_KEY, undefined);
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
