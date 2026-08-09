import { useEffect } from "react";
import type { PayloadbuilderCatalogPanelProps } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { getConfiguredMongoConnections } from "./mongodb-settings";

const MONGODB_CATALOG_ID = "mongodb";
let registered = false;

export function registerPayloadbuilderMongoCatalogContribution(): void {
  if (registered) {
    return;
  }
  registered = true;

  registerPayloadbuilderCatalogContribution({
    catalogId: MONGODB_CATALOG_ID,
    title: "MongoDB",
    defaultAlias: "mongo",
    allowMultiple: true,
    order: 17,
    filterPersistedProperties: (properties) => ({
      connectionId: asText(properties.connectionId)
    }),
    resolveRuntimeProperties: (properties) => resolveRuntimeProperties(properties),
    renderPanel: (props) => <MongoPanel {...props} />
  });
}

function MongoPanel({ alias, properties, setProperty }: PayloadbuilderCatalogPanelProps): JSX.Element {
  const connections = getConfiguredMongoConnections().filter((connection) => connection.enabled);
  const hasConfiguredConnectionProperty = Object.prototype.hasOwnProperty.call(properties, "connectionId");
  const configuredConnectionId = asText(properties.connectionId);
  const configuredConnection = connections.find((connection) => connection.connectionId === configuredConnectionId);
  const selectedConnection = configuredConnection ?? (!hasConfiguredConnectionProperty ? connections[0] : undefined);
  const selectedConnectionId = selectedConnection?.connectionId ?? "";

  useEffect(() => {
    if (!hasConfiguredConnectionProperty && selectedConnectionId) {
      setProperty("connectionId", selectedConnectionId);
    }
    if (configuredConnectionId && !configuredConnection) {
      setProperty("connectionId", "");
    }
  }, [configuredConnection, configuredConnectionId, hasConfiguredConnectionProperty, selectedConnectionId, setProperty]);

  return (
    <div className="payloadbuilder-catalog-fields">
      <label className="payloadbuilder-catalog-label" htmlFor={`payloadbuilder-mongodb-connection-${alias}`}>
        Connection
      </label>
      <select
        id={`payloadbuilder-mongodb-connection-${alias}`}
        className="payloadbuilder-catalog-select"
        value={selectedConnectionId}
        disabled={connections.length === 0}
        onChange={(event) => setProperty("connectionId", event.target.value)}
      >
        <option value="">{connections.length === 0 ? "No connections configured" : "Select connection"}</option>
        {connections.map((connection) => (
          <option key={connection.connectionId} value={connection.connectionId}>
            {connection.title?.trim() || "Untitled connection"}
          </option>
        ))}
      </select>
    </div>
  );
}

function resolveRuntimeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const connectionId = asText(properties.connectionId);
  if (!connectionId) {
    return {};
  }
  const connection = getConfiguredMongoConnections().find(
    (candidate) => candidate.enabled && candidate.connectionId === connectionId
  );
  return connection ? { connectionId } : {};
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
