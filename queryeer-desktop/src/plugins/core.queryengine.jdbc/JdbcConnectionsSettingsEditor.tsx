import { useEffect, useMemo, useState } from "react";
import type { SecretRefValue } from "../../contracts/security/Security";
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
  enabled: boolean;
};

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

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
      setValue(
        nextRows.map((row) => ({
          connectionId: row.connectionId,
          title: row.title || undefined,
          dialectId: row.dialectId,
          url: row.url,
          username: row.username || undefined,
          password: row.password,
          enabled: row.enabled
        }))
      );
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
      connectionId: "",
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
      connectionId: buildCloneConnectionId(source.connectionId, rows)
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
      const result = await getQueryEngineService().invoke({
        engineId: "jdbc",
        action: "jdbc.connection.test",
        payload: {
          dialectId: row.dialectId,
          url: row.url,
          username: row.username || undefined,
          password: row.password
        }
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
        label: row.connectionId || "(new jdbc connection)",
        subtitle: row.url || "URL required",
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
          <div className="payloadbuilder-settings-detail-grid" role="group" aria-label="JDBC connection details">
            <div className="payloadbuilder-settings-cell">
              <label className="payloadbuilder-catalog-label" htmlFor={`jdbc-connection-id-${row.id}`}>
                Connection ID
              </label>
              <input
                id={`jdbc-connection-id-${row.id}`}
                className="payloadbuilder-catalog-input"
                value={row.connectionId}
                readOnly={readonly}
                onChange={(event) => updateRow(row.id, { connectionId: event.target.value })}
              />
            </div>

            <div className="payloadbuilder-settings-cell">
              <label className="payloadbuilder-catalog-label" htmlFor={`jdbc-dialect-${row.id}`}>
                Dialect
              </label>
              <select
                id={`jdbc-dialect-${row.id}`}
                className="payloadbuilder-catalog-select"
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

            <div className="payloadbuilder-settings-cell">
              <label className="payloadbuilder-catalog-label" htmlFor={`jdbc-url-${row.id}`}>
                JDBC URL
              </label>
              <input
                id={`jdbc-url-${row.id}`}
                className="payloadbuilder-catalog-input"
                value={row.url}
                readOnly={readonly}
                onChange={(event) => updateRow(row.id, { url: event.target.value })}
              />
            </div>

            <div className="payloadbuilder-settings-cell">
              <label className="payloadbuilder-catalog-label" htmlFor={`jdbc-username-${row.id}`}>
                Username
              </label>
              <input
                id={`jdbc-username-${row.id}`}
                className="payloadbuilder-catalog-input"
                value={row.username}
                readOnly={readonly}
                onChange={(event) => updateRow(row.id, { username: event.target.value })}
              />
            </div>

            <div className="payloadbuilder-settings-cell">
              <label className="payloadbuilder-catalog-label" htmlFor={`jdbc-password-${row.id}`}>
                Password
              </label>
              <PasswordFieldInput
                inputId={`jdbc-password-${row.id}`}
                valueRef={row.password}
                readonly={readonly}
                onChangeRef={(nextRef) => updateRow(row.id, { password: nextRef })}
              />
            </div>

            <div className="payloadbuilder-settings-cell">
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
                      ? "payloadbuilder-settings-error"
                      : "payloadbuilder-settings-help"
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

function toRows(definitions: JdbcConnectionDefinition[]): Row[] {
  return definitions.map((definition) => ({
    id: crypto.randomUUID(),
    connectionId: definition.connectionId,
    title: definition.title ?? "",
    dialectId: definition.dialectId,
    url: definition.url,
    username: definition.username ?? "",
    password:
      definition.password && typeof definition.password === "object"
        ? definition.password
        : undefined,
    enabled: definition.enabled
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
      url: definition.url,
      username: definition.username ?? "",
      password:
        definition.password && typeof definition.password === "object"
          ? definition.password
          : undefined,
      enabled: definition.enabled
    };
  });
}

function buildRowErrors(rows: Row[]): Record<string, { connectionId?: string; url?: string }> {
  const idCounts = new Map<string, number>();
  for (const row of rows) {
    const id = row.connectionId.trim();
    if (!id) {
      continue;
    }
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }

  const errors: Record<string, { connectionId?: string; url?: string }> = {};
  for (const row of rows) {
    const rowError: { connectionId?: string; url?: string } = {};
    if (!row.connectionId.trim()) {
      rowError.connectionId = "Connection ID is required";
    } else if ((idCounts.get(row.connectionId.trim()) ?? 0) > 1) {
      rowError.connectionId = "Connection ID must be unique";
    }

    if (!row.url.trim()) {
      rowError.url = "JDBC URL is required";
    }

    if (rowError.connectionId || rowError.url) {
      errors[row.id] = rowError;
    }
  }
  return errors;
}

function buildCloneConnectionId(connectionId: string, rows: Row[]): string {
  const normalized = connectionId.trim() || "jdbc";
  const taken = new Set(rows.map((row) => row.connectionId.trim()));
  if (!taken.has(normalized)) {
    return normalized;
  }
  let index = 2;
  while (taken.has(`${normalized}${index}`)) {
    index++;
  }
  return `${normalized}${index}`;
}
