import { useEffect, useState } from "react";
import type { SecretRefValue } from "../../contracts/security/Security";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import "../core.queryengine.jdbc/jdbc-settings.css";

const MSSQL_JDBC_MAVEN_URL = "https://central.sonatype.com/artifact/com.microsoft.sqlserver/mssql-jdbc";

function toFileUri(rawPath: string): string {
  return "file:///" + rawPath.replace(/\\/g, "/");
}

export type SqlServerProperties = {
  host?: string;
  port?: number | string;
  instanceName?: string;
  database?: string;
  authType?: string;
  username?: string;
  password?: string;
  domain?: string;
  encrypt?: string;
  trustServerCertificate?: boolean;
  hostNameInCertificate?: string;
  krb5ConfigFile?: string;
  jaasConfigEntry?: string;
};

type Props = {
  connectionId: string;
  properties: SqlServerProperties;
  password?: SecretRefValue;
  readonly: boolean;
  onChange: (patch: { properties?: SqlServerProperties; password?: SecretRefValue }) => void;
};

const AUTH_TYPE_SQL = "SQL_SERVER_AUTH";
const AUTH_TYPE_WINDOWS_NATIVE = "WINDOWS_NATIVE_AUTH";
const AUTH_TYPE_WINDOWS_NTLM = "WINDOWS_NTLM_AUTH";
const AUTH_TYPE_KERBEROS = "JAVA_KERBEROS";

const AUTH_OPTIONS = [
  { value: AUTH_TYPE_SQL, label: "SQL Server Authentication" },
  { value: AUTH_TYPE_WINDOWS_NATIVE, label: "Windows Native Authentication", windowsOnly: true },
  { value: AUTH_TYPE_WINDOWS_NTLM, label: "Windows NTLM Authentication" },
  { value: AUTH_TYPE_KERBEROS, label: "Java Kerberos (cross-platform)" }
];

export function SqlServerConnectionForm({ connectionId, properties, password, readonly, onChange }: Props): JSX.Element {
  const authType = properties.authType ?? AUTH_TYPE_SQL;
  const isWindows = window.appShell.platform === "win32";
  const [appDir, setAppDir] = useState<string | null>(null);

  useEffect(() => {
    void window.appShell.getAppDir().then(setAppDir);
  }, []);

  const updateProp = (key: keyof SqlServerProperties, value: unknown): void => {
    onChange({ properties: { ...properties, [key]: value } });
  };

  const id = (suffix: string): string => `sqlserver-${connectionId}-${suffix}`;

  const authOptions = AUTH_OPTIONS.filter((o) => !o.windowsOnly || isWindows);

  const openFolder = (subDir: string): void => {
    if (!appDir) return;
    void window.appShell.openPath(toFileUri(appDir + "/" + subDir));
  };

  return (
    <>
      <div className="jdbc-settings-cell">
        <span className="jdbc-settings-help">
          Requires <code>mssql-jdbc-*.jar</code> from{" "}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); void window.appShell.openExternal(MSSQL_JDBC_MAVEN_URL); }}
          >
            Maven Central
          </a>
          {" "}placed in{" "}
          <a href="#" onClick={(e) => { e.preventDefault(); openFolder("libShared"); }}>
            <code>libShared/</code>
          </a>
          {" "}under the app data directory.
        </span>
      </div>

      {authType === AUTH_TYPE_WINDOWS_NATIVE && (
        <div className="jdbc-settings-cell">
          <span className="jdbc-settings-help">
            Windows Native Authentication requires <code>mssql-jdbc_auth-*.dll</code> in{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); openFolder("libNative"); }}>
              <code>libNative/</code>
            </a>
            {" "}under the app data directory.
          </span>
        </div>
      )}

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
          value={properties.port ?? 1433}
          readOnly={readonly}
          onChange={(e) => updateProp("port", e.target.value ? Number(e.target.value) : undefined)}
        />
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("instanceName")}>
          Instance Name
        </label>
        <input
          id={id("instanceName")}
          className="jdbc-settings-input"
          value={properties.instanceName ?? ""}
          placeholder="SQLEXPRESS (blank for default)"
          readOnly={readonly}
          onChange={(e) => updateProp("instanceName", e.target.value)}
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
          placeholder="Initial database (optional)"
          readOnly={readonly}
          onChange={(e) => updateProp("database", e.target.value)}
        />
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("authType")}>
          Authentication
        </label>
        <select
          id={id("authType")}
          className="jdbc-settings-select"
          value={authType}
          disabled={readonly}
          onChange={(e) => updateProp("authType", e.target.value)}
        >
          {authOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {(authType === AUTH_TYPE_SQL || authType === AUTH_TYPE_WINDOWS_NTLM) && (
        <>
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
        </>
      )}

      {authType === AUTH_TYPE_WINDOWS_NTLM && (
        <div className="jdbc-settings-cell">
          <label className="jdbc-settings-label" htmlFor={id("domain")}>
            Windows Domain
          </label>
          <input
            id={id("domain")}
            className="jdbc-settings-input"
            value={properties.domain ?? ""}
            placeholder="CORP (optional)"
            readOnly={readonly}
            onChange={(e) => updateProp("domain", e.target.value)}
          />
        </div>
      )}

      {authType === AUTH_TYPE_KERBEROS && (
        <>
          <div className="jdbc-settings-cell">
            <label className="jdbc-settings-label" htmlFor={id("krb5ConfigFile")}>
              Kerberos Config File
            </label>
            <input
              id={id("krb5ConfigFile")}
              className="jdbc-settings-input"
              value={properties.krb5ConfigFile ?? ""}
              placeholder="/etc/krb5.conf or C:\Windows\krb5.ini"
              readOnly={readonly}
              onChange={(e) => updateProp("krb5ConfigFile", e.target.value)}
            />
          </div>

          <div className="jdbc-settings-cell">
            <label className="jdbc-settings-label" htmlFor={id("jaasConfigEntry")}>
              JAAS Config Entry
            </label>
            <input
              id={id("jaasConfigEntry")}
              className="jdbc-settings-input"
              value={properties.jaasConfigEntry ?? "SQLJDBCDriver"}
              readOnly={readonly}
              onChange={(e) => updateProp("jaasConfigEntry", e.target.value)}
            />
          </div>
        </>
      )}

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("encrypt")}>
          Encrypt
        </label>
        <select
          id={id("encrypt")}
          className="jdbc-settings-select"
          value={properties.encrypt ?? "true"}
          disabled={readonly}
          onChange={(e) => updateProp("encrypt", e.target.value)}
        >
          <option value="true">true — encrypt all traffic</option>
          <option value="strict">strict — TLS 1.3 / enforce trust</option>
          <option value="false">false — no encryption</option>
        </select>
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("trustServerCertificate")}>
          Trust Server Certificate
        </label>
        <input
          id={id("trustServerCertificate")}
          type="checkbox"
          checked={properties.trustServerCertificate === true}
          disabled={readonly}
          onChange={(e) => updateProp("trustServerCertificate", e.target.checked)}
        />
        <span className="jdbc-settings-help" style={{ marginLeft: "6px" }}>
          Trust self-signed or untrusted certs (use for local dev)
        </span>
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("hostNameInCertificate")}>
          Host Name In Certificate
        </label>
        <input
          id={id("hostNameInCertificate")}
          className="jdbc-settings-input"
          value={properties.hostNameInCertificate ?? ""}
          placeholder="Expected hostname in TLS cert (optional)"
          readOnly={readonly}
          onChange={(e) => updateProp("hostNameInCertificate", e.target.value)}
        />
      </div>
    </>
  );
}
