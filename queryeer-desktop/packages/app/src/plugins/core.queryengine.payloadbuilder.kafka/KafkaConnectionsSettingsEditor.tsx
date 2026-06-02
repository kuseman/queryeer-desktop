import { useEffect, useMemo, useState } from "react";
import { generateConnectionId } from "../../core/utils/ids";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import {
  parseKafkaConnectionDefinitions,
  type KafkaConnectionDefinition,
  type KafkaSaslMechanism,
  type KafkaSecurityProtocol
} from "./kafka-settings";
import type { SecretRefValue } from "@queryeer/api/security/Security";

type Row = {
  id: string;
  connectionId: string;
  title: string;
  bootstrapServers: string;
  schemaRegistryUrl: string;
  securityProtocol: KafkaSecurityProtocol;
  saslMechanism: KafkaSaslMechanism;
  saslJaasConfig?: SecretRefValue;
  enabled: boolean;
};

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

const SASL_SECURITY_PROTOCOLS: ReadonlySet<KafkaSecurityProtocol> = new Set([
  "SASL_PLAINTEXT",
  "SASL_SSL"
]);

const SASL_MECHANISM_OPTIONS: { value: KafkaSaslMechanism; label: string }[] = [
  { value: "PLAIN", label: "PLAIN" },
  { value: "SCRAM-SHA-256", label: "SCRAM-SHA-256" },
  { value: "SCRAM-SHA-512", label: "SCRAM-SHA-512" },
  { value: "OAUTHBEARER", label: "OAUTHBEARER" },
  { value: "GSSAPI", label: "GSSAPI" }
];

const SECURITY_PROTOCOL_OPTIONS: { value: KafkaSecurityProtocol; label: string }[] = [
  { value: "PLAINTEXT", label: "PLAINTEXT" },
  { value: "SSL", label: "SSL" },
  { value: "SASL_PLAINTEXT", label: "SASL_PLAINTEXT" },
  { value: "SASL_SSL", label: "SASL_SSL" }
];

export function KafkaConnectionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[]>(() => toRows(parseKafkaConnectionDefinitions(value)));
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(() => rows[0]?.id);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedRowId(undefined);
      return;
    }
    if (!selectedRowId || !rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(rows[0]?.id);
    }
  }, [rows, selectedRowId]);

  const { persistNow, persistDebounced } = useCollectionSettingsPersistence<Row>({
    persist: (nextRows) => {
      setValue(
        nextRows.map((row) => toDefinition(row))
      );
    }
  });

  const syncRows = (nextRows: Row[], nextSelectedId?: string, options?: { debouncePersist?: boolean }): void => {
    setRows(nextRows);
    if (nextSelectedId !== undefined) {
      setSelectedRowId(nextSelectedId);
    }

    if (options?.debouncePersist) {
      persistDebounced(nextRows);
      return;
    }

    persistNow(nextRows);
  };

  const updateRow = (id: string, patch: Partial<Row>): void => {
    syncRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)), undefined, {
      debouncePersist: true
    });
  };

  const addRow = (): void => {
    const next: Row = {
      id: crypto.randomUUID(),
      connectionId: generateConnectionId(),
      title: "",
      bootstrapServers: "",
      schemaRegistryUrl: "",
      securityProtocol: "PLAINTEXT",
      saslMechanism: "PLAIN",
      enabled: true
    };
    syncRows([...rows, next], next.id);
  };

  const removeRow = (id: string): void => {
    const index = rows.findIndex((row) => row.id === id);
    const nextRows = rows.filter((row) => row.id !== id);
    const nextSelection = nextRows[index]?.id ?? nextRows[index - 1]?.id;
    syncRows(nextRows, nextSelection);
  };

  const cloneRow = (id: string): void => {
    const source = rows.find((row) => row.id === id);
    if (!source) {
      return;
    }
    const clone: Row = {
      ...source,
      id: crypto.randomUUID(),
      connectionId: generateConnectionId()
    };
    syncRows([...rows, clone], clone.id);
  };

  const rowErrors = useMemo(() => buildRowErrors(rows), [rows]);

  return (
    <div className="payloadbuilder-settings-editor">
      <div className="payloadbuilder-settings-help">
        Configure reusable Kafka cluster connections.
      </div>

      <CollectionSettingsListEditor
        items={rows.map((row) => ({
          id: row.id,
          label: row.title.trim() || "Untitled connection",
          subtitle: row.bootstrapServers || "Bootstrap servers required",
          invalid: Boolean(rowErrors[row.id])
        }))}
        selectedId={selectedRowId}
        readonly={readonly}
        addLabel="Add Connection"
        onSelect={setSelectedRowId}
        onAdd={addRow}
        onClone={cloneRow}
        onDelete={removeRow}
        renderDetails={(id) => {
          const row = rows.find((item) => item.id === id);
          if (!row) {
            return <div className="payloadbuilder-catalog-empty">Select a connection to edit details.</div>;
          }

          const showSasl = SASL_SECURITY_PROTOCOLS.has(row.securityProtocol);

          return (
            <div className="payloadbuilder-settings-detail-grid" role="group" aria-label="Kafka connection details">
              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-kafka-connection-title">
                  Title (optional)
                </label>
                <input
                  id="payloadbuilder-kafka-connection-title"
                  className="payloadbuilder-catalog-input"
                  value={row.title}
                  readOnly={readonly}
                  placeholder="Production"
                  onChange={(event) => updateRow(row.id, { title: event.target.value })}
                />
              </div>

              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-kafka-connection-bootstrap">
                  Bootstrap servers
                </label>
                <input
                  id="payloadbuilder-kafka-connection-bootstrap"
                  className="payloadbuilder-catalog-input"
                  value={row.bootstrapServers}
                  readOnly={readonly}
                  placeholder="broker1:9092,broker2:9092"
                  onChange={(event) => updateRow(row.id, { bootstrapServers: event.target.value })}
                />
                {rowErrors[row.id]?.bootstrapServers && (
                  <div className="payloadbuilder-settings-error">{rowErrors[row.id].bootstrapServers}</div>
                )}
              </div>

              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-kafka-connection-schema-registry">
                  Schema Registry URL (optional)
                </label>
                <input
                  id="payloadbuilder-kafka-connection-schema-registry"
                  className="payloadbuilder-catalog-input"
                  value={row.schemaRegistryUrl}
                  readOnly={readonly}
                  placeholder="https://schema-registry:8081"
                  onChange={(event) => updateRow(row.id, { schemaRegistryUrl: event.target.value })}
                />
              </div>

              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-kafka-connection-security-protocol">
                  Security protocol
                </label>
                <select
                  id="payloadbuilder-kafka-connection-security-protocol"
                  className="payloadbuilder-catalog-select"
                  value={row.securityProtocol}
                  disabled={readonly}
                  onChange={(event) => {
                    const nextProtocol = event.target.value as KafkaSecurityProtocol;
                    updateRow(row.id, {
                      securityProtocol: nextProtocol,
                      saslMechanism: SASL_SECURITY_PROTOCOLS.has(nextProtocol) ? row.saslMechanism : "PLAIN"
                    });
                  }}
                >
                  {SECURITY_PROTOCOL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {showSasl && (
                <>
                  <div className="payloadbuilder-settings-cell">
                    <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-kafka-connection-sasl-mechanism">
                      SASL mechanism
                    </label>
                    <select
                      id="payloadbuilder-kafka-connection-sasl-mechanism"
                      className="payloadbuilder-catalog-select"
                      value={row.saslMechanism}
                      disabled={readonly}
                      onChange={(event) => updateRow(row.id, { saslMechanism: event.target.value as KafkaSaslMechanism })}
                    >
                      {SASL_MECHANISM_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="payloadbuilder-settings-cell">
                    <label
                      className="payloadbuilder-catalog-label"
                      htmlFor={`payloadbuilder-kafka-connection-jaas-${row.id}`}
                    >
                      SASL JAAS config
                    </label>
                    <PasswordFieldInput
                      inputId={`payloadbuilder-kafka-connection-jaas-${row.id}`}
                      valueRef={row.saslJaasConfig}
                      readonly={readonly}
                      onChangeRef={(nextRef) => updateRow(row.id, { saslJaasConfig: nextRef })}
                    />
                  </div>
                </>
              )}

              <label className="payloadbuilder-settings-enabled">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  disabled={readonly}
                  onChange={(event) => updateRow(row.id, { enabled: event.target.checked })}
                />
                <span>{row.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
          );
        }}
      />
    </div>
  );
}

function toDefinition(row: Row): KafkaConnectionDefinition {
  return {
    connectionId: row.connectionId,
    title: row.title || undefined,
    bootstrapServers: row.bootstrapServers,
    schemaRegistryUrl: row.schemaRegistryUrl || undefined,
    securityProtocol: row.securityProtocol,
    saslMechanism: SASL_SECURITY_PROTOCOLS.has(row.securityProtocol) ? row.saslMechanism : undefined,
    saslJaasConfig: row.saslJaasConfig,
    enabled: row.enabled
  };
}

function toRows(definitions: KafkaConnectionDefinition[]): Row[] {
  return definitions.map((definition) => ({
    id: crypto.randomUUID(),
    connectionId: definition.connectionId,
    title: definition.title ?? "",
    bootstrapServers: definition.bootstrapServers,
    schemaRegistryUrl: definition.schemaRegistryUrl ?? "",
    securityProtocol: definition.securityProtocol,
    saslMechanism: definition.saslMechanism ?? "PLAIN",
    saslJaasConfig:
      definition.saslJaasConfig && typeof definition.saslJaasConfig === "object"
        ? definition.saslJaasConfig
        : undefined,
    enabled: definition.enabled
  }));
}

function buildRowErrors(rows: Row[]): Record<string, { bootstrapServers?: string }> {
  const errors: Record<string, { bootstrapServers?: string }> = {};
  for (const row of rows) {
    const bootstrap = row.bootstrapServers.trim();
    const rowError: { bootstrapServers?: string } = {};

    if (!bootstrap) {
      rowError.bootstrapServers = "Bootstrap servers are required";
    }

    if (rowError.bootstrapServers) {
      errors[row.id] = rowError;
    }
  }

  return errors;
}
