import { useEffect, useMemo, useState } from "react";
import { getJdbcDatabaseCache } from "../core.queryengine.jdbc/jdbc-database-cache";
import { getConfiguredJdbcConnections } from "../core.queryengine.jdbc/jdbc-settings";
import type { PayloadbuilderCatalogPanelProps } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";

const JDBC_CATALOG_ID = "jdbc";

let registered = false;

export function registerPayloadbuilderJdbcCatalogContribution(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerPayloadbuilderCatalogContribution({
    catalogId: JDBC_CATALOG_ID,
    title: "JDBC",
    defaultAlias: "jdbc",
    allowMultiple: true,
    order: 20,
    filterPersistedProperties: (properties) => ({
      connectionId: asText(properties.connectionId),
      database: asText(properties.database)
    }),
    resolveRuntimeProperties: (properties) => properties,
    flowMappingFields: [
      {
        id: "connectionId",
        label: "Connection",
        kind: "select",
        required: true,
        persistAsLabel: true,
        mappingKind: "jdbc.connection",
        placeholder: "Select connection...",
        listOptions: () => getConfiguredJdbcConnections()
          .filter((connection) => connection.enabled)
          .map((connection) => ({
            value: connection.connectionId,
            label: connection.title?.trim() || connection.connectionId
          }))
      },
      {
        id: "database",
        label: "Database",
        kind: "select",
        placeholder: "Select database...",
        listOptions: async (values) => {
          const connectionId = values.connectionId;
          return connectionId ? getJdbcDatabaseCache().load(connectionId) : [];
        }
      }
    ],
    renderPanel: (props) => <PayloadbuilderJdbcPanel {...props} />
  });
}

function PayloadbuilderJdbcPanel({ alias, properties, setProperty }: PayloadbuilderCatalogPanelProps): JSX.Element {
  const connections = getConfiguredJdbcConnections().filter((connection) => connection.enabled);
  const configuredConnectionId = asText(properties.connectionId);
  const selectedConnection = connections.find((connection) => connection.connectionId === configuredConnectionId) ?? connections[0];
  const selectedConnectionId = selectedConnection?.connectionId ?? "";
  const selectedDatabase = asText(properties.database);
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDatabases, setLoadingDatabases] = useState(false);

  const selectableDatabases = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const value of [selectedDatabase, ...databases]) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      values.push(normalized);
    }
    return values;
  }, [databases, selectedDatabase]);

  useEffect(() => {
    if (selectedConnectionId && configuredConnectionId !== selectedConnectionId) {
      setProperty("connectionId", selectedConnectionId);
    }
  }, [configuredConnectionId, selectedConnectionId, setProperty]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedConnectionId) {
        setDatabases([]);
        return;
      }
      setLoadingDatabases(true);
      try {
        const values = await getJdbcDatabaseCache().load(selectedConnectionId);
        if (!cancelled) {
          setDatabases(values);
        }
      } catch {
        if (!cancelled) {
          setDatabases([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingDatabases(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedConnectionId]);

  return (
    <div className="payloadbuilder-catalog-fields">
      <label className="payloadbuilder-catalog-label" htmlFor={`payloadbuilder-jdbc-connection-${alias}`}>
        Connection
      </label>
      <select
        id={`payloadbuilder-jdbc-connection-${alias}`}
        className="payloadbuilder-catalog-select"
        value={selectedConnectionId}
        disabled={connections.length === 0}
        onChange={(event) => {
          setProperty("connectionId", event.target.value);
          setProperty("database", "");
          setDatabases([]);
        }}
      >
        {connections.length === 0 && <option value="">No connections configured</option>}
        {connections.map((connection) => (
          <option key={connection.connectionId} value={connection.connectionId}>
            {connection.title?.trim() || "Untitled connection"}
          </option>
        ))}
      </select>

      <label className="payloadbuilder-catalog-label" htmlFor={`payloadbuilder-jdbc-database-${alias}`}>
        Database
      </label>
      <select
        id={`payloadbuilder-jdbc-database-${alias}`}
        className="payloadbuilder-catalog-select"
        value={selectedDatabase}
        disabled={loadingDatabases || selectableDatabases.length === 0}
        onChange={(event) => setProperty("database", event.target.value)}
      >
        {selectableDatabases.length === 0 && <option value="">No databases available</option>}
        {selectableDatabases.length > 0 && <option value="">Select database</option>}
        {selectableDatabases.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>
    </div>
  );
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
