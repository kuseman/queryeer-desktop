import { useEffect, useMemo, useState } from "react";
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
    resolveRuntimeProperties: (properties) => properties,
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
  const configuredConnectionId = asText(properties.connectionId);
  const selectedConnection =
    connections.find((connection) => connection.connectionId === configuredConnectionId) ?? connections[0];
  const selectedConnectionId = selectedConnection?.connectionId ?? "";
  const selectedTopic = asText(properties.topic);
  const [topics, setTopics] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

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
    if (selectedConnectionId && configuredConnectionId !== selectedConnectionId) {
      setProperty("connectionId", selectedConnectionId);
    }
  }, [configuredConnectionId, selectedConnectionId, setProperty]);

  const loadTopics = async (): Promise<void> => {
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
      setTopics(next);
      if (next.length > 0 && !next.includes(selectedTopic)) {
        setProperty("topic", next[0]);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
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
        onChange={(event) => {
          const nextConnectionId = event.target.value;
          setProperty("connectionId", nextConnectionId);
          setProperty("topic", "");
          setTopics([]);
          setError(undefined);
        }}
      >
        {connections.length === 0 && <option value="">No connections configured</option>}
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
        onChange={(event) => setProperty("topic", event.target.value)}
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
