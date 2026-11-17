import { useEffect, useMemo, useState } from "react";
import type { SecretRefValue } from "@queryeer/api/security/Security";
import { generateConnectionId } from "../../core/utils/ids";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { pathToFileUri } from "@queryeer/api/files/Resolvers";
import {
  CollectionSettingsListEditor,
  useCollectionSettingsPersistence
} from "../core.settings/CollectionSettingsListEditor";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import {
  parseJdbcConnectionDefinitions,
  type JdbcConnectionDefinition
} from "./jdbc-settings";
import { getJdbcDialect, subscribeJdbcDialects } from "./jdbc-dialect-registry";
import type { JdbcConnectionSetupDefinition } from "@queryeer/api/queryengine/JdbcDialectExtension.js";
import {
  JdbcConnectionFieldsForm,
  fieldsSubtitle,
  parseConnectionSetup,
  validateFields,
  withFieldDefaults
} from "./jdbc-connection-fields";
import "./jdbc-settings.css";

type JdbcDialectOption = {
  id: string;
  displayName: string;
  /** The connection form fields the backend dialect defines; without them, the generic URL form. */
  connectionSetup?: JdbcConnectionSetupDefinition;
};

type SetupLookup = (dialectId: string) => JdbcConnectionSetupDefinition | undefined;

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

const TEST_CONNECTION_SUFFIX = "::test";

export function JdbcConnectionsSettingsEditor({ value, readonly, setValue }: Props): JSX.Element {
  const [rows, setRows] = useState<Row[]>(() => toRows(parseJdbcConnectionDefinitions(value)));
  const [selectedRowId, setSelectedRowId] = useState<string | undefined>(() => rows[0]?.id);
  const [dialects, setDialects] = useState<JdbcDialectOption[]>([{ id: "jdbc", displayName: "Other Database (JDBC)" }]);
  // Until the backend's dialect list arrives, a dialect's fields are unknown
  const [dialectsState, setDialectsState] = useState<"loading" | "loaded" | "failed">("loading");
  const [appDir, setAppDir] = useState<string | null>(null);

  useEffect(() => {
    void window.appShell.getAppDir().then(setAppDir);
  }, []);
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
          .filter((entry): entry is { id: string; displayName: string; connectionSetup?: unknown } => {
            return (
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as { id?: unknown }).id === "string" &&
              typeof (entry as { displayName?: unknown }).displayName === "string"
            );
          })
          .map((entry) => ({ id: entry.id, displayName: entry.displayName, connectionSetup: parseConnectionSetup(entry.connectionSetup) }));
        if (next.length > 0) {
          setDialects(next);
        }
        setDialectsState("loaded");
      })
      .catch(() => {
        setDialectsState("failed");
      });
  }, []);

  // A plugin that registers its dialect's frontend additions after this editor opened
  const [dialectRegistryVersion, setDialectRegistryVersion] = useState(0);
  useEffect(() => subscribeJdbcDialects(() => setDialectRegistryVersion((version) => version + 1)), []);

  const setupFor: SetupLookup = (dialectId) => dialects.find((dialect) => dialect.id === dialectId)?.connectionSetup;

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
      setValue(nextRows.map((row) => serializeRow(row, setupFor(row.dialectId))));
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
      connectionId: generateConnectionId(),
      // A secretRef points at one vault entry; sharing it would make edits to either
      // connection's password overwrite the other's. The clone starts without one.
      password: undefined
    };
    syncRows([...rows, clone], clone.id);
  };

  const rowErrors = useMemo(() => buildRowErrors(rows, setupFor), [rows, dialects, dialectRegistryVersion]);

  const testConnection = async (row: Row): Promise<void> => {
    const testConnectionId = `${row.connectionId}${TEST_CONNECTION_SUFFIX}`;
    setTestStatusByRowId((previous) => ({
      ...previous,
      [row.id]: { state: "running", message: "Testing..." }
    }));

    try {
      const result = await getQueryEngineService().invoke({
        engineId: "jdbc",
        action: "jdbc.connection.test",
        payload: {
          connectionId: testConnectionId,
          title: row.title,
          connection: serializeRow(row, setupFor(row.dialectId))
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
        label: row.title.trim() || "Untitled connection",
        subtitle: buildSubtitle(row, setupFor(row.dialectId)),
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
          <div className="jdbc-settings-detail-grid" role="group" aria-label="Database connection details">
            <div className="jdbc-settings-cell">
              <span className="jdbc-settings-help">
                JDBC driver JARs must be placed in{" "}
                <a
                  href="#"
                  onClick={(e) => { e.preventDefault(); if (appDir) void window.appShell.openPath(pathToFileUri(appDir + "/libShared")); }}
                >
                  <code>libShared/</code>
                </a>
                {" "}under the app data directory.
              </span>
            </div>

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
                Database Type
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

            {renderDialectForm(row, readonly, (patch) => {
              updateRow(row.id, {
                ...(patch.properties !== undefined ? { properties: patch.properties } : {}),
                ...(patch.password !== undefined ? { password: patch.password } : {})
              });
            }, updateRow, setupFor(row.dialectId), dialectsState)}

            <label className="jdbc-settings-enabled" title="Only enabled connections are listed in the database tree and the connection selector">
              <input
                type="checkbox"
                checked={row.enabled}
                disabled={readonly}
                onChange={(event) => updateRow(row.id, { enabled: event.target.checked })}
              />
              {/* A fixed label: the checkbox shows the state */}
              <span>Enabled</span>
            </label>

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

/**
 * A dialect's form: its own component when its frontend registered one, else the form rendered from its backend
 * fields, else the generic JDBC URL form. A connection described by properties never gets the URL form, which would
 * turn it into a URL connection: it waits for its dialect's fields instead.
 */
function renderDialectForm(
  row: Row,
  readonly: boolean,
  onChange: (patch: { properties?: Record<string, unknown>; password?: SecretRefValue }) => void,
  updateRowLocal: (id: string, patch: Partial<Row>) => void,
  setup: JdbcConnectionSetupDefinition | undefined,
  dialectsState: "loading" | "loaded" | "failed"
): JSX.Element {
  const dialect = getJdbcDialect(row.dialectId);
  if (dialect?.ConnectionForm) {
    const FormComponent = dialect.ConnectionForm;
    return (
      <FormComponent
        connectionId={row.id}
        properties={row.properties ?? {}}
        password={row.password}
        readonly={readonly}
        onChange={onChange}
      />
    );
  }
  if (setup) {
    return (
      <JdbcConnectionFieldsForm
        connectionId={row.id}
        setup={setup}
        properties={row.properties ?? {}}
        password={row.password}
        readonly={readonly}
        onChange={onChange}
      />
    );
  }
  if (usesProperties(row, setup)) {
    return (
      <div className="jdbc-settings-cell">
        <span className="jdbc-settings-help">
          {dialectsState === "loading"
            ? "Loading the connection form…"
            : "This database type's connection form is not available. Is its plugin installed and enabled?"}
        </span>
      </div>
    );
  }

  return (
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
          onChange={(event) => updateRowLocal(row.id, { url: event.target.value })}
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
          onChange={(event) => updateRowLocal(row.id, { username: event.target.value })}
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
          onChangeRef={(nextRef) => updateRowLocal(row.id, { password: nextRef })}
        />
      </div>
    </>
  );
}

/**
 * Whether a connection is described by properties (a dialect's own or field-rendered form) rather than a JDBC URL.
 * A connection that already has properties keeps them while the backend's dialect list is still loading.
 */
function usesProperties(row: Row, setup: JdbcConnectionSetupDefinition | undefined): boolean {
  // The generic dialect is always a JDBC URL
  if (row.dialectId === GENERIC_DIALECT_ID) {
    return false;
  }
  return Boolean(getJdbcDialect(row.dialectId)?.ConnectionForm) || setup !== undefined || (row.properties !== undefined && !row.url);
}

const GENERIC_DIALECT_ID = "jdbc";

function buildSubtitle(row: Row, setup: JdbcConnectionSetupDefinition | undefined): string {
  const properties = row.properties ?? {};
  const dialect = getJdbcDialect(row.dialectId);
  if (dialect?.subtitle) {
    return dialect.subtitle(properties);
  }
  if (setup) {
    return fieldsSubtitle(setup, properties);
  }
  return row.url || "URL required";
}

function serializeRow(row: Row, setup: JdbcConnectionSetupDefinition | undefined): unknown {
  const base = {
    connectionId: row.connectionId,
    title: row.title || undefined,
    dialectId: row.dialectId,
    password: row.password,
    enabled: row.enabled,
    color: row.color || undefined
  };
  if (usesProperties(row, setup)) {
    const properties = row.properties ?? {};
    return {
      ...base,
      // Store the defaults the form showed, so the backend dialect builds the URL the user saw
      properties: setup && !getJdbcDialect(row.dialectId)?.ConnectionForm ? withFieldDefaults(setup, properties) : properties
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
/** Problems per row id: the dialect's own `validate`, else its backend's required fields, else a missing JDBC URL. */
function buildRowErrors(rows: Row[], setupFor: SetupLookup): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const row of rows) {
    const properties = row.properties ?? {};
    const setup = setupFor(row.dialectId);
    const dialect = getJdbcDialect(row.dialectId);
    let problems: string[];
    if (dialect?.validate) {
      problems = dialect.validate(properties);
    } else if (setup) {
      problems = validateFields(setup, properties);
    } else if (usesProperties(row, setup)) {
      // Properties whose dialect the backend has not described yet
      problems = [];
    } else {
      problems = row.url.trim() ? [] : ["JDBC URL is required"];
    }
    if (problems.length > 0) {
      errors[row.id] = problems;
    }
  }
  return errors;
}
