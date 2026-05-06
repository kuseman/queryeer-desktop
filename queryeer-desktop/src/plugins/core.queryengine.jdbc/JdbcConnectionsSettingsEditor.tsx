import { useEffect, useMemo, useState } from "react";
import type { SecretRefValue } from "../../contracts/security/Security";
import { generateConnectionId } from "../../core/utils/ids";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import {
  parseJdbcConnectionDefinitions,
  type JdbcConnectionDefinition
} from "./jdbc-settings";
import { SqlServerConnectionForm, type SqlServerProperties } from "./SqlServerConnectionForm";
import "./jdbc-settings.css";

type JdbcDialectOption = {
  id: string;
  displayName: string;
};

type Row = {
  id: string;
  connectionId: string;
  title: string;
  dialectId: string;
  url: string;
  username: string;
  password?: SecretRefValue;
  properties?: Record<string, unknown>;
  enabled: boolean;
  color?: string;
};

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

const SQLSERVER_DIALECT_ID = "sqlserver";

export function JdbcConnectionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[]>(() => toRows(parseJdbcConnectionDefinitions(value)));
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(() => rows[0]?.id);
  const [dialects, setDialects] = useState<JdbcDialectOption[]>([{ id: "jdbc", displayName: "Generic JDBC" }]);
  const [testStatusByRowId, setTestStatusByRowId] = useState<
    Record<string, { state: "idle" | "running" | "ok" | "error"; message?: string }>
  >({});

  useEffect(() => {
    void getQueryEngineService()
      .invoke({ engineId: "jdbc", action: "jdbc.connection.dialects" })
      .then((result) => {
        if (!Array.isArray(result)) {
          return;
        }
        const next = result
          .filter((entry): entry is { id: string; displayName: string } => {
            return (
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as { id?: unknown }).id === "string" &&
              typeof (entry as { displayName?: unknown }).displayName === "string"
            );
          })
          .map((entry) => ({ id: entry.id, displayName: entry.displayName }));
        if (next.length > 0) {
          setDialects(next);
        }
      })
      .catch(() => {
      });
  }, []);

  useEffect(() => {
    const incoming = parseJdbcConnectionDefinitions(value);
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
      setValue(nextRows.map((row) => serializeRow(row)));
    }
  });

  const syncRows = (nextRows: Row[], nextSelectedId?: string, debouncePersist = false): void => {
    setRows(nextRows);
    if (nextSelectedId !== undefined) {
      setSelectedRowId(nextSelectedId);
    }

    if (debouncePersist) {
      persistDebounced(nextRows);
      return;
    }
    persistNow(nextRows);
  };

  const updateRow = (id: string, patch: Partial<Row>): void => {
    syncRows(
      rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      undefined,
      true
    );
  };

  const addRow = (): void => {
    const row: Row = {
      id: crypto.randomUUID(),
      connectionId: generateConnectionId(),
      title: "",
      dialectId: dialects[0]?.id ?? "jdbc",
      url: "",
      username: "",
      enabled: true
    };
    syncRows([...rows, row], row.id);
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

  const testConnection = async (row: Row): Promise<void> => {
    setTestStatusByRowId((previous) => ({
      ...previous,
      [row.id]: { state: "running", message: "Testing..." }
    }));

    try {
      const payload =
        row.dialectId === SQLSERVER_DIALECT_ID
          ? { dialectId: row.dialectId, ...row.properties, password: row.password }
          : { dialectId: row.dialectId, url: row.url, username: row.username || undefined, password: row.password };

      const result = await getQueryEngineService().invoke({
        engineId: "jdbc",
        action: "jdbc.connection.test",
        payload
      });

      const message =
        typeof result === "object" && result !== null && typeof (result as { message?: unknown }).message === "string"
          ? ((result as { message: string }).message ?? "Connection configuration is valid")
          : "Connection configuration is valid";

      setTestStatusByRowId((previous) => ({
        ...previous,
        [row.id]: { state: "ok", message }
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection configuration failed";
      setTestStatusByRowId((previous) => ({
        ...previous,
        [row.id]: { state: "error", message }
      }));
    }
  };

  return (
    <CollectionSettingsListEditor
      items={rows.map((row) => ({
        id: row.id,
        label: row.title.trim() || "Untitled connection",
        subtitle: buildSubtitle(row),
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
          return <div className="jdbc-settings-empty">Select a connection to edit details.</div>;
        }

        return (
          <div className="jdbc-settings-detail-grid" role="group" aria-label="JDBC connection details">
            <div className="jdbc-settings-cell">
              <label className="jdbc-settings-label" htmlFor={`jdbc-title-${row.id}`}>
                Title
              </label>
              <input
                id={`jdbc-title-${row.id}`}
                className="jdbc-settings-input"
                value={row.title}
                readOnly={readonly}
                placeholder="Untitled connection"
                onChange={(event) => updateRow(row.id, { title: event.target.value })}
              />
            </div>

            <div className="jdbc-settings-cell">
              <label className="jdbc-settings-label" htmlFor={`jdbc-color-${row.id}`}>
                Color
              </label>
              <div className="jdbc-settings-color">
                <label htmlFor={`jdbc-color-${row.id}`} className="jdbc-settings-color-swatch-wrapper" title="Set or change color">
                  <input
                    id={`jdbc-color-${row.id}`}
                    type="color"
                    className="jdbc-settings-color-input-hidden"
                    value={row.color ?? "#000000"}
                    disabled={readonly}
                    onChange={(event) => updateRow(row.id, { color: event.target.value })}
                  />
                  <span
                    className="jdbc-settings-color-swatch"
                    style={{ backgroundColor: row.color ?? "transparent" }}
                  />
                </label>
                {row.color && (
                  <button
                    type="button"
                    className="jdbc-settings-color-clear"
                    disabled={readonly}
                    onClick={() => updateRow(row.id, { color: undefined })}
                    title="Clear color"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>

            <div className="jdbc-settings-cell">
              <label className="jdbc-settings-label" htmlFor={`jdbc-dialect-${row.id}`}>
                Dialect
              </label>
              <select
                id={`jdbc-dialect-${row.id}`}
                className="jdbc-settings-select"
                value={row.dialectId}
                disabled={readonly}
                onChange={(event) => updateRow(row.id, { dialectId: event.target.value })}
              >
                {dialects.map((dialect) => (
                  <option key={dialect.id} value={dialect.id}>
                    {dialect.displayName}
                  </option>
                ))}
              </select>
            </div>

            {row.dialectId === SQLSERVER_DIALECT_ID ? (
              <SqlServerConnectionForm
                connectionId={row.id}
                properties={(row.properties ?? {}) as SqlServerProperties}
                password={row.password}
                readonly={readonly}
                onChange={(patch) => {
                  updateRow(row.id, {
                    ...(patch.properties !== undefined ? { properties: patch.properties as Record<string, unknown> } : {}),
                    ...(patch.password !== undefined ? { password: patch.password } : {})
                  });
                }}
              />
            ) : (
              <>
                <div className="jdbc-settings-cell">
                  <label className="jdbc-settings-label" htmlFor={`jdbc-url-${row.id}`}>
                    JDBC URL
                  </label>
                  <input
                    id={`jdbc-url-${row.id}`}
                    className="jdbc-settings-input"
                    value={row.url}
                    readOnly={readonly}
                    onChange={(event) => updateRow(row.id, { url: event.target.value })}
                  />
                </div>

                <div className="jdbc-settings-cell">
                  <label className="jdbc-settings-label" htmlFor={`jdbc-username-${row.id}`}>
                    Username
                  </label>
                  <input
                    id={`jdbc-username-${row.id}`}
                    className="jdbc-settings-input"
                    value={row.username}
                    readOnly={readonly}
                    onChange={(event) => updateRow(row.id, { username: event.target.value })}
                  />
                </div>

                <div className="jdbc-settings-cell">
                  <label className="jdbc-settings-label" htmlFor={`jdbc-password-${row.id}`}>
                    Password
                  </label>
                  <PasswordFieldInput
                    inputId={`jdbc-password-${row.id}`}
                    valueRef={row.password}
                    readonly={readonly}
                    onChangeRef={(nextRef) => updateRow(row.id, { password: nextRef })}
                  />
                </div>
              </>
            )}

            <div className="jdbc-settings-cell">
              <button
                type="button"
                className="settings-list-editor-icon-button"
                disabled={readonly || testStatusByRowId[row.id]?.state === "running"}
                onClick={() => {
                  void testConnection(row);
                }}
              >
                {testStatusByRowId[row.id]?.state === "running" ? "Testing..." : "Test Connection"}
              </button>
              {testStatusByRowId[row.id]?.message ? (
                <div
                  className={
                    testStatusByRowId[row.id]?.state === "error"
                      ? "jdbc-settings-error"
                      : "jdbc-settings-help"
                  }
                >
                  {testStatusByRowId[row.id]?.message}
                </div>
              ) : null}
            </div>
          </div>
        );
      }}
    />
  );
}

function buildSubtitle(row: Row): string {
  if (row.dialectId === SQLSERVER_DIALECT_ID) {
    const host = String(row.properties?.host ?? "");
    const port = row.properties?.port ?? 1433;
    const database = String(row.properties?.database ?? "");
    if (!host) return "Host required";
    return database ? `${host}:${port}/${database}` : `${host}:${port}`;
  }
  return row.url || "URL required";
}

function serializeRow(row: Row): unknown {
  const base = {
    connectionId: row.connectionId,
    title: row.title || undefined,
    dialectId: row.dialectId,
    password: row.password,
    enabled: row.enabled,
    color: row.color || undefined
  };
  if (row.dialectId === SQLSERVER_DIALECT_ID) {
    return {
      ...base,
      properties: row.properties ?? {}
    };
  }
  return {
    ...base,
    url: row.url,
    username: row.username || undefined
  };
}

function toRows(definitions: JdbcConnectionDefinition[]): Row[] {
  return definitions.map((definition) => ({
    id: crypto.randomUUID(),
    connectionId: definition.connectionId,
    title: definition.title ?? "",
    dialectId: definition.dialectId,
    url: definition.url ?? "",
    username: definition.username ?? "",
    password:
      definition.password && typeof definition.password === "object"
        ? definition.password
        : undefined,
    properties: definition.properties,
    enabled: definition.enabled,
    color: definition.color
  }));
}

function mergeRows(previous: Row[], definitions: JdbcConnectionDefinition[]): Row[] {
  const byConnectionId = new Map(previous.map((row) => [row.connectionId.trim(), row]));
  return definitions.map((definition, index) => {
    const fromIndex = previous[index];
    const fromConnectionId = byConnectionId.get(definition.connectionId);
    return {
      id: fromIndex?.id ?? fromConnectionId?.id ?? crypto.randomUUID(),
      connectionId: definition.connectionId,
      title: definition.title ?? "",
      dialectId: definition.dialectId,
      url: definition.url ?? "",
      username: definition.username ?? "",
      password:
        definition.password && typeof definition.password === "object"
          ? definition.password
          : undefined,
      properties: definition.properties,
      enabled: definition.enabled,
      color: definition.color
    };
  });
}

function buildRowErrors(rows: Row[]): Record<string, { url?: string; host?: string }> {
  const errors: Record<string, { url?: string; host?: string }> = {};
  for (const row of rows) {
    const rowError: { url?: string; host?: string } = {};

    if (row.dialectId === SQLSERVER_DIALECT_ID) {
      const host = String(row.properties?.host ?? "").trim();
      if (!host) {
        rowError.host = "Host is required";
      }
    } else if (!row.url.trim()) {
      rowError.url = "JDBC URL is required";
    }

    if (rowError.url || rowError.host) {
      errors[row.id] = rowError;
    }
  }
  return errors;
}
