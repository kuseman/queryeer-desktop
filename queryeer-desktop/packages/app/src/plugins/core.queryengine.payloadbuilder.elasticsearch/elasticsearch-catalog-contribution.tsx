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
    defaultAlias: "es",
    allowMultiple: true,
    order: 10,
    filterPersistedProperties: (properties) => ({
      connectionId: asText(properties.connectionId),
      index: asText(properties.index)
    }),
    resolveRuntimeProperties: (properties) => resolveRuntimeProperties(properties),
    flowMappingFields: [
      {
        id: "connectionId",
        label: "Connection",
        kind: "select",
        required: true,
        persistAsLabel: true,
        mappingKind: "elasticsearch.connection",
        placeholder: "Select connection...",
        listOptions: () => getConfiguredElasticsearchConnections()
          .filter((connection) => connection.enabled)
          .map((connection) => ({
            value: connection.connectionId,
            label: connection.title?.trim() || connection.connectionId
          }))
      },
      {
        id: "index",
        label: "Index",
        kind: "text",
        required: true,
        placeholder: "orders-*"
      }
    ],
    renderPanel: (props) => <ElasticsearchPanel {...props} />
  });
}

function ElasticsearchPanel({ fileId, alias, properties, setProperty }: PayloadbuilderCatalogPanelProps): JSX.Element {
  const connections = getConfiguredElasticsearchConnections().filter((connection) => connection.enabled);
  const hasConfiguredConnectionProperty = Object.prototype.hasOwnProperty.call(properties, "connectionId");
  const configuredConnectionId = asText(properties.connectionId);
  const configuredConnection = connections.find((connection) => connection.connectionId === configuredConnectionId);
  const selectedConnection = configuredConnection ?? (!hasConfiguredConnectionProperty ? connections[0] : undefined);
  const selectedConnectionId = selectedConnection?.connectionId ?? "";
  const selectedIndex = configuredConnection ? asText(properties.index) : "";
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
    if (!hasConfiguredConnectionProperty && selectedConnectionId) {
      setProperty("connectionId", selectedConnectionId);
    }
    if (configuredConnectionId && !configuredConnection) {
      setProperty("connectionId", "");
      setProperty("index", "");
    }
  }, [configuredConnection, configuredConnectionId, hasConfiguredConnectionProperty, selectedConnectionId, setProperty]);

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
            connectionId: selectedConnection.connectionId
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
        <option value="">{connections.length === 0 ? "No connections configured" : "Select connection"}</option>
        {connections.map((connection) => (
          <option key={connection.connectionId} value={connection.connectionId}>
            {connection.title?.trim() || "Untitled connection"}
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

function resolveRuntimeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const connectionId = asText(properties.connectionId);
  if (!connectionId) {
    return {};
  }
  const connection = getConfiguredElasticsearchConnections().find(
    (candidate) => candidate.enabled && candidate.connectionId === connectionId
  );
  if (!connection) {
    return {};
  }
  return {
    connectionId,
    ...(asText(properties.index) ? { index: asText(properties.index) } : {})
  };
}
