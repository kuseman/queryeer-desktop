import type { SecretRefValue } from "@queryeer/api/security/Security";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import "../core.queryengine.jdbc/jdbc-settings.css";

const PG_JDBC_MAVEN_URL = "https://central.sonatype.com/artifact/org.postgresql/postgresql";

export type PostgresProperties = {
  host?: string;
  port?: number | string;
  database?: string;
  username?: string;
  sslMode?: string;
};

type Props = {
  connectionId: string;
  properties: PostgresProperties;
  password?: SecretRefValue;
  readonly: boolean;
  onChange: (patch: { properties?: PostgresProperties; password?: SecretRefValue }) => void;
};

const SSL_OPTIONS = [
  { value: "disable", label: "Disable" },
  { value: "prefer", label: "Prefer (try SSL, fall back to plain)" },
  { value: "require", label: "Require (enforce TLS)" },
  { value: "verify-ca", label: "Verify CA (check server certificate)" },
  { value: "verify-full", label: "Verify Full (check CA + hostname)" }
];

export function PostgresConnectionForm({ connectionId, properties, password, readonly, onChange }: Props): JSX.Element {
  const updateProp = (key: keyof PostgresProperties, value: unknown): void => {
    onChange({ properties: { ...properties, [key]: value } });
  };

  const id = (suffix: string): string => `postgres-${connectionId}-${suffix}`;

  return (
    <>
      <div className="jdbc-settings-cell">
        <span className="jdbc-settings-help">
          Requires <code>postgresql-*.jar</code> from{" "}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); void window.appShell.openExternal(PG_JDBC_MAVEN_URL); }}
          >
            Maven Central
          </a>
          {" "}placed in <code>libShared/</code> under the app data directory.
        </span>
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("host")}>
          Host
        </label>
        <input
          id={id("host")}
          className="jdbc-settings-input"
          value={properties.host ?? ""}
          placeholder="localhost"
          readOnly={readonly}
          onChange={(e) => updateProp("host", e.target.value)}
        />
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("port")}>
          Port
        </label>
        <input
          id={id("port")}
          className="jdbc-settings-input"
          type="number"
          value={properties.port ?? 5432}
          readOnly={readonly}
          onChange={(e) => updateProp("port", e.target.value ? Number(e.target.value) : undefined)}
        />
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("database")}>
          Database
        </label>
        <input
          id={id("database")}
          className="jdbc-settings-input"
          value={properties.database ?? ""}
          placeholder="e.g., my_database"
          readOnly={readonly}
          required
          onChange={(e) => updateProp("database", e.target.value)}
        />
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("username")}>
          Username
        </label>
        <input
          id={id("username")}
          className="jdbc-settings-input"
          value={properties.username ?? ""}
          readOnly={readonly}
          onChange={(e) => updateProp("username", e.target.value)}
        />
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("password")}>
          Password
        </label>
        <PasswordFieldInput
          inputId={id("password")}
          valueRef={password}
          readonly={readonly}
          onChangeRef={(nextRef) => onChange({ password: nextRef })}
        />
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("sslMode")}>
          SSL Mode
        </label>
        <select
          id={id("sslMode")}
          className="jdbc-settings-select"
          value={properties.sslMode ?? "prefer"}
          disabled={readonly}
          onChange={(e) => updateProp("sslMode", e.target.value)}
        >
          {SSL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
