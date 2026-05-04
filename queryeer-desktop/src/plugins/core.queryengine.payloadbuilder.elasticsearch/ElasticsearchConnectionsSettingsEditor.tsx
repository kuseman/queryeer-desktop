import { useEffect, useMemo, useState } from "react";
import { generateConnectionId } from "../../core/utils/ids";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import {
  parseElasticsearchConnectionDefinitions,
  type ElasticsearchConnectionDefinition
} from "./elasticsearch-settings";
import type { SecretRefValue } from "../../contracts/security/Security";

type Row = {
  id: string;
  connectionId: string;
  title: string;
  endpoint: string;
  authType: "NONE" | "BASIC";
  authUsername: string;
  authPassword?: SecretRefValue;
  enabled: boolean;
};

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

export function ElasticsearchConnectionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[]>(() => toRows(parseElasticsearchConnectionDefinitions(value)));
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(() => rows[0]?.id);

  useEffect(() => {
    const incoming = parseElasticsearchConnectionDefinitions(value);
    setRows((previous) => mergeRows(previous, incoming));
  }, [value]);

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
        nextRows.map((row) => ({
          connectionId: row.connectionId,
          title: row.title || undefined,
          endpoint: row.endpoint,
          authType: row.authType,
          authUsername: row.authUsername || undefined,
          authPassword: row.authPassword,
          enabled: row.enabled
        }))
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
      endpoint: "",
      authType: "NONE",
      authUsername: "",
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
        Configure reusable Elasticsearch cluster connections.
      </div>

      <CollectionSettingsListEditor
      items={rows.map((row) => ({
        id: row.id,
        label: row.title.trim() || "Untitled connection",
        subtitle: row.endpoint || "Endpoint required",
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

          return (
            <div className="payloadbuilder-settings-detail-grid" role="group" aria-label="Elasticsearch connection details">
              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-es-connection-title">
                  Title (optional)
                </label>
                <input
                  id="payloadbuilder-es-connection-title"
                  className="payloadbuilder-catalog-input"
                  value={row.title}
                  readOnly={readonly}
                  placeholder="Production"
                  onChange={(event) => updateRow(row.id, { title: event.target.value })}
                />
              </div>

              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-es-connection-endpoint">
                  Endpoint
                </label>
                <input
                  id="payloadbuilder-es-connection-endpoint"
                  className="payloadbuilder-catalog-input"
                  value={row.endpoint}
                  readOnly={readonly}
                  placeholder="https://localhost:9200"
                  onChange={(event) => updateRow(row.id, { endpoint: event.target.value })}
                />
                {rowErrors[row.id]?.endpoint && (
                  <div className="payloadbuilder-settings-error">{rowErrors[row.id].endpoint}</div>
                )}
              </div>

              <div className="payloadbuilder-settings-cell">
                <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-es-connection-auth-type">
                  Auth
                </label>
                <select
                  id="payloadbuilder-es-connection-auth-type"
                  className="payloadbuilder-catalog-select"
                  value={row.authType}
                  disabled={readonly}
                  onChange={(event) => updateRow(row.id, { authType: event.target.value as "NONE" | "BASIC" })}
                >
                  <option value="NONE">None</option>
                  <option value="BASIC">Basic</option>
                </select>
              </div>

              {row.authType === "BASIC" && (
                <>
                  <div className="payloadbuilder-settings-cell">
                    <label className="payloadbuilder-catalog-label" htmlFor="payloadbuilder-es-connection-username">
                      Username
                    </label>
                    <input
                      id="payloadbuilder-es-connection-username"
                      className="payloadbuilder-catalog-input"
                      value={row.authUsername}
                      readOnly={readonly}
                      onChange={(event) => updateRow(row.id, { authUsername: event.target.value })}
                    />
                  </div>
                  <div className="payloadbuilder-settings-cell">
                    <label
                      className="payloadbuilder-catalog-label"
                      htmlFor={`payloadbuilder-es-connection-password-${row.id}`}
                    >
                      Password
                    </label>
                    <PasswordFieldInput
                      inputId={`payloadbuilder-es-connection-password-${row.id}`}
                      valueRef={row.authPassword}
                      readonly={readonly}
                      onChangeRef={(nextRef) => updateRow(row.id, { authPassword: nextRef })}
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

function toRows(definitions: ElasticsearchConnectionDefinition[]): Row[] {
  return definitions.map((definition) => ({
    id: crypto.randomUUID(),
    connectionId: definition.connectionId,
    title: definition.title ?? "",
    endpoint: definition.endpoint,
    authType: definition.authType,
    authUsername: definition.authUsername ?? "",
    authPassword:
      definition.authPassword && typeof definition.authPassword === "object"
        ? definition.authPassword
        : undefined,
    enabled: definition.enabled
  }));
}

function mergeRows(previous: Row[], definitions: ElasticsearchConnectionDefinition[]): Row[] {
  const byConnectionId = new Map(previous.map((row) => [row.connectionId.trim(), row]));
  return definitions.map((definition, index) => {
    const fromIndex = previous[index];
    const fromConnectionId = byConnectionId.get(definition.connectionId);
    const id = fromIndex?.id ?? fromConnectionId?.id ?? crypto.randomUUID();
    return {
      id,
      connectionId: definition.connectionId,
      title: definition.title ?? "",
      endpoint: definition.endpoint,
      authType: definition.authType,
      authUsername: definition.authUsername ?? "",
      authPassword:
        definition.authPassword && typeof definition.authPassword === "object"
          ? definition.authPassword
          : undefined,
      enabled: definition.enabled
    };
  });
}

function buildRowErrors(rows: Row[]): Record<string, { endpoint?: string }> {
  const errors: Record<string, { endpoint?: string }> = {};
  for (const row of rows) {
    const endpoint = row.endpoint.trim();
    const rowError: { endpoint?: string } = {};

    if (!endpoint) {
      rowError.endpoint = "Endpoint is required";
    }

    if (rowError.endpoint) {
      errors[row.id] = rowError;
    }
  }

  return errors;
}
