import type { SecretRefValue } from "@queryeer/api/security/Security";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { generateConnectionId } from "../../core/utils/ids";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import {
  isMongoConnectionString,
  parseMongoConnectionDefinitions,
  type MongoConnectionDefinition
} from "./mongodb-settings";

type Row = {
  id: string;
  connectionId: string;
  title: string;
  connectionString: string;
  authUsername: string;
  authPassword?: SecretRefValue;
  authDatabase: string;
  enabled: boolean;
};

type Props = {
  value: unknown;
  readonly: boolean;
  setValue: (next: unknown) => void;
};

export function MongoConnectionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[]>(() => toRows(parseMongoConnectionDefinitions(value)));
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(() => rows[0]?.id);

  useEffect(() => {
    if (rows.length === 0) {
      setSelectedRowId(undefined);
    } else if (!selectedRowId || !rows.some((row) => row.id === selectedRowId)) {
      setSelectedRowId(rows[0]?.id);
    }
  }, [rows, selectedRowId]);

  const { persistNow, persistDebounced } = useCollectionSettingsPersistence<Row>({
    persist: (nextRows) => setValue(nextRows.map(toDefinition))
  });

  const syncRows = (nextRows: Row[], nextSelectedId?: string, debouncePersist = false): void => {
    setRows(nextRows);
    if (nextSelectedId !== undefined) {
      setSelectedRowId(nextSelectedId);
    }
    if (debouncePersist) {
      persistDebounced(nextRows);
    } else {
      persistNow(nextRows);
    }
  };

  const updateRow = (id: string, patch: Partial<Row>): void => {
    syncRows(rows.map((row) => row.id === id ? { ...row, ...patch } : row), undefined, true);
  };

  const addRow = (): void => {
    const next: Row = {
      id: crypto.randomUUID(),
      connectionId: generateConnectionId(),
      title: "",
      connectionString: "mongodb://localhost:27017",
      authUsername: "",
      authDatabase: "admin",
      enabled: true
    };
    syncRows([...rows, next], next.id);
  };

  const removeRow = (id: string): void => {
    const index = rows.findIndex((row) => row.id === id);
    const nextRows = rows.filter((row) => row.id !== id);
    syncRows(nextRows, nextRows[index]?.id ?? nextRows[index - 1]?.id);
  };

  const cloneRow = (id: string): void => {
    const source = rows.find((row) => row.id === id);
    if (!source) {
      return;
    }
    const clone = { ...source, id: crypto.randomUUID(), connectionId: generateConnectionId() };
    syncRows([...rows, clone], clone.id);
  };

  const rowErrors = useMemo(() => buildRowErrors(rows), [rows]);

  return (
    <div className="payloadbuilder-settings-editor">
      <div className="payloadbuilder-settings-help">Configure reusable MongoDB connections.</div>
      <CollectionSettingsListEditor
        items={rows.map((row) => ({
          id: row.id,
          label: row.title.trim() || "Untitled connection",
          subtitle: row.connectionString || "Connection string required",
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
            <div className="payloadbuilder-settings-detail-grid" role="group" aria-label="MongoDB connection details">
              <Field label="Title (optional)" id="payloadbuilder-mongodb-title">
                <input id="payloadbuilder-mongodb-title" className="payloadbuilder-catalog-input" value={row.title}
                  readOnly={readonly} placeholder="Production" onChange={(event) => updateRow(row.id, { title: event.target.value })} />
              </Field>
              <Field label="Connection string" id="payloadbuilder-mongodb-connection-string">
                <input id="payloadbuilder-mongodb-connection-string" className="payloadbuilder-catalog-input" value={row.connectionString}
                  readOnly={readonly} placeholder="mongodb://localhost:27017"
                  onChange={(event) => updateRow(row.id, { connectionString: event.target.value })} />
                {rowErrors[row.id]?.connectionString && <div className="payloadbuilder-settings-error">{rowErrors[row.id].connectionString}</div>}
              </Field>
              <Field label="Username (optional)" id="payloadbuilder-mongodb-username">
                <input id="payloadbuilder-mongodb-username" className="payloadbuilder-catalog-input" value={row.authUsername}
                  readOnly={readonly} onChange={(event) => updateRow(row.id, { authUsername: event.target.value })} />
              </Field>
              <Field label="Password" id={`payloadbuilder-mongodb-password-${row.id}`}>
                <PasswordFieldInput inputId={`payloadbuilder-mongodb-password-${row.id}`} valueRef={row.authPassword}
                  readonly={readonly} onChangeRef={(authPassword) => updateRow(row.id, { authPassword })} />
              </Field>
              <Field label="Authentication database" id="payloadbuilder-mongodb-auth-database">
                <input id="payloadbuilder-mongodb-auth-database" className="payloadbuilder-catalog-input" value={row.authDatabase}
                  readOnly={readonly} placeholder="admin" onChange={(event) => updateRow(row.id, { authDatabase: event.target.value })} />
              </Field>
              <label className="payloadbuilder-settings-enabled">
                <input type="checkbox" checked={row.enabled} disabled={readonly}
                  onChange={(event) => updateRow(row.id, { enabled: event.target.checked })} />
                <span>{row.enabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>
          );
        }}
      />
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: ReactNode }): JSX.Element {
  return <div className="payloadbuilder-settings-cell"><label className="payloadbuilder-catalog-label" htmlFor={id}>{label}</label>{children}</div>;
}

function toDefinition(row: Row): MongoConnectionDefinition {
  return {
    connectionId: row.connectionId,
    title: row.title || undefined,
    connectionString: row.connectionString,
    authUsername: row.authUsername || undefined,
    authPassword: row.authPassword,
    authDatabase: row.authDatabase || undefined,
    enabled: row.enabled
  };
}

function toRows(definitions: MongoConnectionDefinition[]): Row[] {
  return definitions.map((definition) => ({
    id: crypto.randomUUID(),
    connectionId: definition.connectionId,
    title: definition.title ?? "",
    connectionString: definition.connectionString,
    authUsername: definition.authUsername ?? "",
    authPassword: typeof definition.authPassword === "object" ? definition.authPassword : undefined,
    authDatabase: definition.authDatabase ?? "admin",
    enabled: definition.enabled
  }));
}

function buildRowErrors(rows: Row[]): Record<string, { connectionString?: string }> {
  const errors: Record<string, { connectionString?: string }> = {};
  for (const row of rows) {
    if (!isMongoConnectionString(row.connectionString.trim())) {
      errors[row.id] = { connectionString: "Use a mongodb:// or mongodb+srv:// connection string" };
    }
  }
  return errors;
}
