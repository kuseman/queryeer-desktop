import { useCallback, useEffect, useState } from "react";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { JDBC_NAV_DB_KEY, type JdbcSchemaObject } from "./jdbc-navigation-types";
import { getConfiguredJdbcConnections } from "./jdbc-settings";

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
    (filesRegistry.getEditorState(fileId, JDBC_NAV_DB_KEY) as string | undefined) ?? ""
  );
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);

  const loadDatabases = useCallback(
    async (connId: string) => {
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
        })) as JdbcSchemaObject[];
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
        const persisted = (filesRegistry.getEditorState(fileId, JDBC_NAV_DB_KEY) as string | undefined) ?? "";
        setSelectedDatabase(persisted);
      }
    });
  }, [filesRegistry, fileId]);

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
    filesRegistry.setEditorState(fileId, JDBC_NAV_DB_KEY, db);
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
              {c.title ?? c.connectionId}
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
