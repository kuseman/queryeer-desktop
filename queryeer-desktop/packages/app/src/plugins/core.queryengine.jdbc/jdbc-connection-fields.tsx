import type { SecretRefValue } from "@queryeer/api/security/Security";
import type {
  JdbcConnectionFieldDefinition,
  JdbcConnectionSetupDefinition
} from "@queryeer/api/queryengine/JdbcDialectExtension.js";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import "./jdbc-settings.css";

/**
 * A dialect's connection form, rendered from the fields its backend `JdbcDialect.connectionSetup()` defines. Values
 * are stored in the connection's properties under each field's id; a `SECRET` field is the connection's password.
 */

/** Reads a dialect's `connectionSetup` from a `jdbc.connection.dialects` entry, or undefined when it has none or it is malformed. */
export function parseConnectionSetup(value: unknown): JdbcConnectionSetupDefinition | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const fields = (value as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) {
    return undefined;
  }
  const valid: JdbcConnectionFieldDefinition[] = [];
  for (const field of fields) {
    if (typeof field !== "object" || field === null) {
      continue;
    }
    const candidate = field as Record<string, unknown>;
    if (typeof candidate.id !== "string" || candidate.id.length === 0 || typeof candidate.label !== "string" || !FIELD_TYPES.has(String(candidate.type))) {
      continue;
    }
    // Normalized, so a malformed entry cannot break rendering
    const options = Array.isArray(candidate.options)
      ? candidate.options
        .filter((option): option is { value: unknown; label: unknown } => typeof option === "object" && option !== null)
        .map((option) => ({ value: String(option.value), label: String(option.label ?? option.value) }))
      : undefined;
    const visibleWhen = typeof candidate.visibleWhen === "object" && candidate.visibleWhen !== null && !Array.isArray(candidate.visibleWhen)
      ? Object.fromEntries(Object.entries(candidate.visibleWhen).map(([key, value]) => [key, String(value)]))
      : undefined;
    valid.push({
      id: candidate.id,
      label: candidate.label,
      type: candidate.type as JdbcConnectionFieldDefinition["type"],
      required: candidate.required === true,
      description: typeof candidate.description === "string" ? candidate.description : undefined,
      options,
      defaultValue: candidate.defaultValue ?? undefined,
      visibleWhen
    });
  }
  return valid.length > 0 ? { fields: valid } : undefined;
}

const FIELD_TYPES = new Set<string>(["TEXT", "NUMBER", "SECRET", "BOOLEAN", "SELECT", "FOLDER_PATH", "FILE_PATH"]);

/** The value a field shows: the stored property, or the field's default. */
export function fieldValue(field: JdbcConnectionFieldDefinition, properties: Record<string, unknown>): unknown {
  const value = properties[field.id];
  return value === undefined || value === null ? field.defaultValue ?? undefined : value;
}

/** Whether a field is shown: every field named in its `visibleWhen` has the given value. */
export function isFieldVisible(field: JdbcConnectionFieldDefinition, setup: JdbcConnectionSetupDefinition, properties: Record<string, unknown>): boolean {
  if (!field.visibleWhen) {
    return true;
  }
  return Object.entries(field.visibleWhen).every(([otherId, expected]) => {
    const other = setup.fields.find((candidate) => candidate.id === otherId);
    const actual = other ? fieldValue(other, properties) : properties[otherId];
    return String(actual ?? "") === expected;
  });
}

/** The properties to store: the edited ones, plus each field's default where nothing was entered, so the backend sees what the form showed. */
export function withFieldDefaults(setup: JdbcConnectionSetupDefinition, properties: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...properties };
  for (const field of setup.fields) {
    if (field.type === "SECRET") {
      continue;
    }
    if ((result[field.id] === undefined || result[field.id] === null) && field.defaultValue !== undefined && field.defaultValue !== null) {
      result[field.id] = field.defaultValue;
    }
  }
  return result;
}

/** The required, visible, non-secret fields that are empty, as messages. */
export function validateFields(setup: JdbcConnectionSetupDefinition, properties: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const field of setup.fields) {
    if (!field.required || field.type === "SECRET" || field.type === "BOOLEAN" || !isFieldVisible(field, setup, properties)) {
      continue;
    }
    if (String(fieldValue(field, properties) ?? "").trim().length === 0) {
      problems.push(`${field.label} is required`);
    }
  }
  return problems;
}

/** `host:port/database` when the dialect has a host field, else the first required field's value. */
export function fieldsSubtitle(setup: JdbcConnectionSetupDefinition, properties: Record<string, unknown>): string {
  const text = (id: string): string => {
    const field = setup.fields.find((candidate) => candidate.id === id);
    return String((field ? fieldValue(field, properties) : properties[id]) ?? "").trim();
  };
  if (setup.fields.some((field) => field.id === "host")) {
    const host = text("host");
    if (!host) {
      return "Host required";
    }
    const port = text("port");
    const database = text("database");
    const base = port ? `${host}:${port}` : host;
    return database ? `${base}/${database}` : base;
  }
  const first = setup.fields.find((field) => field.required && field.type !== "SECRET") ?? setup.fields.find((field) => field.type !== "SECRET");
  if (!first) {
    return "";
  }
  return text(first.id) || `${first.label} required`;
}

type FormProps = {
  connectionId: string;
  setup: JdbcConnectionSetupDefinition;
  properties: Record<string, unknown>;
  password?: SecretRefValue;
  readonly: boolean;
  onChange: (patch: { properties?: Record<string, unknown>; password?: SecretRefValue }) => void;
};

export function JdbcConnectionFieldsForm({ connectionId, setup, properties, password, readonly, onChange }: FormProps): JSX.Element {
  const update = (id: string, value: unknown): void => {
    const next = { ...properties };
    if (value === undefined || value === "") {
      delete next[id];
    } else {
      next[id] = value;
    }
    onChange({ properties: next });
  };

  return (
    <>
      {setup.fields
        .filter((field) => isFieldVisible(field, setup, properties))
        .map((field) => {
          const inputId = `jdbc-field-${connectionId}-${field.id}`;
          const value = fieldValue(field, properties);
          const label = (
            <label className="jdbc-settings-label" htmlFor={inputId}>
              {field.label}
              {field.required && field.type !== "SECRET" ? " *" : ""}
            </label>
          );
          const help = field.description ? <span className="jdbc-settings-help">{field.description}</span> : null;

          if (field.type === "BOOLEAN") {
            return (
              <div key={field.id} className="jdbc-settings-cell">
                <label className="jdbc-settings-enabled">
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={value === true || value === "true"}
                    disabled={readonly}
                    onChange={(event) => update(field.id, event.target.checked)}
                  />
                  <span>{field.label}</span>
                </label>
                {help}
              </div>
            );
          }

          let control: JSX.Element;
          if (field.type === "SECRET") {
            control = (
              <PasswordFieldInput
                inputId={inputId}
                valueRef={password}
                readonly={readonly}
                onChangeRef={(nextRef) => onChange({ password: nextRef })}
              />
            );
          } else if (field.type === "SELECT") {
            control = (
              <select
                id={inputId}
                className="jdbc-settings-select"
                value={String(value ?? "")}
                disabled={readonly}
                onChange={(event) => update(field.id, event.target.value)}
              >
                {value === undefined ? <option value="" /> : null}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            );
          } else if (field.type === "NUMBER") {
            control = (
              <input
                id={inputId}
                className="jdbc-settings-input"
                type="number"
                value={value === undefined ? "" : String(value)}
                readOnly={readonly}
                onChange={(event) => update(field.id, event.target.value ? Number(event.target.value) : undefined)}
              />
            );
          } else if (field.type === "FOLDER_PATH" || field.type === "FILE_PATH") {
            const browse = (): Promise<string | undefined> =>
              field.type === "FOLDER_PATH"
                ? window.appShell.showOpenFolder({ title: field.label }).then((result) => (result.canceled ? undefined : result.folderPath))
                : window.appShell.showDialogOpen({ title: field.label }).then((result) => (result.canceled ? undefined : result.filePaths[0]));
            control = (
              <div className="jdbc-settings-path">
                <input
                  id={inputId}
                  className="jdbc-settings-input"
                  value={String(value ?? "")}
                  readOnly={readonly}
                  onChange={(event) => update(field.id, event.target.value)}
                />
                <button
                  type="button"
                  className="jdbc-settings-button"
                  disabled={readonly}
                  onClick={() => {
                    void browse().then((path) => {
                      if (path) {
                        update(field.id, path);
                      }
                    });
                  }}
                >
                  Browse…
                </button>
              </div>
            );
          } else {
            control = (
              <input
                id={inputId}
                className="jdbc-settings-input"
                value={String(value ?? "")}
                readOnly={readonly}
                onChange={(event) => update(field.id, event.target.value)}
              />
            );
          }

          return (
            <div key={field.id} className="jdbc-settings-cell">
              {label}
              {control}
              {help}
            </div>
          );
        })}
    </>
  );
}
