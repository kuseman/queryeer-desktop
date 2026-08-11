import { useEffect, useMemo, useRef, useState } from "react";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import type { PayloadbuilderCatalogPanelProps } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { getConfiguredKafkaConnections } from "./kafka-settings";

const KAFKA_CATALOG_ID = "kafka";
type ListTopicsResult = {
  topics?: string[];
};

let registered = false;

export function registerPayloadbuilderKafkaCatalogContribution(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerPayloadbuilderCatalogContribution({
    catalogId: KAFKA_CATALOG_ID,
    title: "Kafka",
    defaultAlias: "kafka",
    allowMultiple: true,
    order: 15,
    filterPersistedProperties: (properties) => ({
      connectionId: asText(properties.connectionId),
      topic: asText(properties.topic)
    }),
    resolveRuntimeProperties: (properties) => resolveRuntimeProperties(properties),
    flowMappingFields: [
      {
        id: "connectionId",
        label: "Connection",
        kind: "select",
        required: true,
        persistAsLabel: true,
        mappingKind: "kafka.connection",
        placeholder: "Select connection...",
        listOptions: () => getConfiguredKafkaConnections()
          .filter((connection) => connection.enabled)
          .map((connection) => ({
            value: connection.connectionId,
            label: connection.title?.trim() || connection.connectionId
          }))
      },
      {
        id: "topic",
        label: "Topic",
        kind: "text",
        required: false,
        placeholder: "orders"
      }
    ],
    renderPanel: (props) => <KafkaPanel {...props} />
  });
}

function KafkaPanel({ fileId, alias, properties, setProperty }: PayloadbuilderCatalogPanelProps): JSX.Element {
  const connections = getConfiguredKafkaConnections().filter((connection) => connection.enabled);
  const hasConfiguredConnectionProperty = Object.prototype.hasOwnProperty.call(properties, "connectionId");
  const configuredConnectionId = asText(properties.connectionId);
  const configuredConnection = connections.find((connection) => connection.connectionId === configuredConnectionId);
  const selectedConnection = configuredConnection ?? (!hasConfiguredConnectionProperty ? connections[0] : undefined);
  const selectedConnectionId = selectedConnection?.connectionId ?? "";
  const selectedTopic = configuredConnection ? asText(properties.topic) : "";
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const reloadGeneration = useRef(0);

  const selectableTopics = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const value of [selectedTopic, ...topics]) {
      const normalized = value.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      values.push(normalized);
    }
    return values;
  }, [topics, selectedTopic]);

  useEffect(() => {
    if (!hasConfiguredConnectionProperty && selectedConnectionId) {
      setProperty("connectionId", selectedConnectionId);
    }
    if (configuredConnectionId && !configuredConnection) {
      setProperty("connectionId", "");
      setProperty("topic", "");
    }
  }, [configuredConnection, configuredConnectionId, hasConfiguredConnectionProperty, selectedConnectionId, setProperty]);

  useEffect(() => {
    reloadGeneration.current += 1;
    setTopics([]);
    setLoading(false);
    setError(undefined);
  }, [alias, fileId, selectedConnectionId]);

  const loadTopics = async (): Promise<void> => {
    const generation = ++reloadGeneration.current;
    setLoading(true);
    setError(undefined);
    try {
      if (!selectedConnection) {
        throw new Error("No Kafka connection configured");
      }
      const result = (await getQueryEngineService().invoke({
        engineId: "payloadbuilder",
        fileId,
        action: "payloadbuilder.kafka.listTopics",
        payload: {
          alias,
          properties: {
            connectionId: selectedConnection.connectionId
          }
        }
      })) as ListTopicsResult | undefined;
      const next = Array.isArray(result?.topics)
        ? result.topics.filter((entry): entry is string => typeof entry === "string")
        : [];
      if (generation !== reloadGeneration.current) {
        return;
      }
      setTopics(next);
      if (next.length > 0 && !next.includes(selectedTopic)) {
        setProperty("topic", next[0]);
      }
    } catch (loadError) {
      if (generation === reloadGeneration.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (generation === reloadGeneration.current) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="payloadbuilder-catalog-fields">
      <label className="payloadbuilder-catalog-label" htmlFor={`payloadbuilder-kafka-connection-${alias}`}>
        Connection
      </label>
      <select
        id={`payloadbuilder-kafka-connection-${alias}`}
        className="payloadbuilder-catalog-select"
        value={selectedConnectionId}
        disabled={connections.length === 0 || loading}
        onInput={(event) => {
          reloadGeneration.current += 1;
          const nextConnectionId = event.currentTarget.value;
          setProperty("connectionId", nextConnectionId);
          setProperty("topic", "");
          setTopics([]);
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

      <label className="payloadbuilder-catalog-label" htmlFor={`payloadbuilder-kafka-topic-${alias}`}>
        Topic
      </label>
      <select
        id={`payloadbuilder-kafka-topic-${alias}`}
        className="payloadbuilder-catalog-select"
        value={selectedTopic}
        disabled={loading || selectableTopics.length === 0}
        onInput={(event) => setProperty("topic", event.currentTarget.value)}
      >
        {selectableTopics.length === 0 && <option value="">No topics loaded</option>}
        {selectableTopics.length > 0 && <option value="">Select topic</option>}
        {selectableTopics.map((entry) => (
          <option key={entry} value={entry}>
            {entry}
          </option>
        ))}
      </select>

      <div className="payloadbuilder-settings-actions">
        <button type="button" className="payloadbuilder-catalog-button" disabled={loading} onClick={loadTopics}>
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
  const connection = getConfiguredKafkaConnections().find(
    (candidate) => candidate.enabled && candidate.connectionId === connectionId
  );
  if (!connection) {
    return {};
  }
  return {
    connectionId,
    ...(asText(properties.topic) ? { topic: asText(properties.topic) } : {})
  };
}
