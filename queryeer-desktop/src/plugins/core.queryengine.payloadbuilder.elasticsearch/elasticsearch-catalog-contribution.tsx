import { useEffect, useMemo, useState } from "react";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import type { PayloadbuilderCatalogPanelProps } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { getConfiguredElasticsearchConnections } from "./elasticsearch-settings";

const ELASTICSEARCH_CATALOG_ID = "elasticsearch";
type ListIndicesResult = {
  indices?: string[];
};

let registered = false;

export function registerPayloadbuilderElasticsearchCatalogContribution(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerPayloadbuilderCatalogContribution({
    catalogId: ELASTICSEARCH_CATALOG_ID,
    title: "Elasticsearch",
    order: 10,
    filterPersistedProperties: (properties) => ({
      connectionId: asText(properties.connectionId),
      index: asText(properties.index)
    }),
    resolveRuntimeProperties: (properties) => {
      const connectionId = asText(properties.connectionId);
      const connection = getConfiguredElasticsearchConnections().find(
        (entry) => entry.connectionId === connectionId
      );
      if (!connection) {
        return properties;
      }
      return {
        ...properties,
        endpoint: connection.endpoint,
        authType: connection.authType,
        authUsername: connection.authUsername,
        authPassword: connection.authPassword
      };
    },
    renderPanel: (props) => <ElasticsearchPanel {...props} />
  });
}

function ElasticsearchPanel({ fileId, alias, properties, setProperty }: PayloadbuilderCatalogPanelProps): JSX.Element {
  const connections = getConfiguredElasticsearchConnections().filter((connection) => connection.enabled);
  const configuredConnectionId = asText(properties.connectionId);
  const selectedConnection =
    connections.find((connection) => connection.connectionId === configuredConnectionId) ?? connections[0];
  const selectedConnectionId = selectedConnection?.connectionId ?? "";
  const selectedIndex = asText(properties.index);
  const [indices, setIndices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const selectableIndices = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const value of [selectedIndex, ...indices]) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      values.push(normalized);
    }
    return values;
  }, [indices, selectedIndex]);

  useEffect(() => {
    if (selectedConnectionId && configuredConnectionId !== selectedConnectionId) {
      setProperty("connectionId", selectedConnectionId);
    }
  }, [configuredConnectionId, selectedConnectionId, setProperty]);

  const loadIndices = async (): Promise<void> => {
    setLoading(true);
    setError(undefined);
    try {
      if (!selectedConnection) {
        throw new Error("No Elasticsearch connection configured");
      }
      const result = (await getQueryEngineService().invoke({
        engineId: "payloadbuilder",
        fileId,
        action: "payloadbuilder.es.listIndices",
        payload: {
          alias,
            properties: {
              endpoint: selectedConnection.endpoint,
              authType: selectedConnection.authType,
              authUsername: selectedConnection.authUsername,
              authPassword: selectedConnection.authPassword
            }
          }
        })) as ListIndicesResult | undefined;
      const next = Array.isArray(result?.indices)
        ? result.indices.filter((entry): entry is string => typeof entry === "string")
        : [];
      setIndices(next);
      if (next.length > 0 && !next.includes(selectedIndex)) {
        setProperty("index", next[0]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="payloadbuilder-catalog-fields">
      <label className="payloadbuilder-catalog-label" htmlFor={`payloadbuilder-es-connection-${alias}`}>
        Connection
      </label>
      <select
        id={`payloadbuilder-es-connection-${alias}`}
        className="payloadbuilder-catalog-select"
        value={selectedConnectionId}
        disabled={connections.length === 0 || loading}
        onChange={(event) => {
          const nextConnectionId = event.target.value;
          setProperty("connectionId", nextConnectionId);
          setProperty("index", "");
          setIndices([]);
          setError(undefined);
        }}
      >
        {connections.length === 0 && <option value="">No connections configured</option>}
        {connections.map((connection) => (
          <option key={connection.connectionId} value={connection.connectionId}>
            {connection.title?.trim() || connection.connectionId}
          </option>
        ))}
      </select>

      <label className="payloadbuilder-catalog-label" htmlFor={`payloadbuilder-es-index-${alias}`}>
        Indices
      </label>
      <select
        id={`payloadbuilder-es-index-${alias}`}
        className="payloadbuilder-catalog-select"
        value={selectedIndex}
        disabled={loading || selectableIndices.length === 0}
        onChange={(event) => setProperty("index", event.target.value)}
      >
        {selectableIndices.length === 0 && <option value="">No indices loaded</option>}
        {selectableIndices.length > 0 && <option value="">Select index</option>}
        {selectableIndices.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>

      <div className="payloadbuilder-settings-actions">
        <button type="button" className="payloadbuilder-catalog-button" disabled={loading} onClick={loadIndices}>
          {loading ? "Reloading..." : "Reload"}
        </button>
      </div>

      {error && <div className="payloadbuilder-settings-error">{error}</div>}
    </div>
  );
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
