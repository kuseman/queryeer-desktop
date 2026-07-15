import type { SecretRefValue } from "@queryeer/api/security/Security";
import { PasswordFieldInput } from "../core.settings/PasswordFieldInput";
import "../core.queryengine.jdbc/jdbc-settings.css";

const SQLITE_JDBC_MAVEN_URL = "https://central.sonatype.com/artifact/org.xerial/sqlite-jdbc";

export type SqliteProperties = {
  filePath?: string;
  password?: string;
};

type Props = {
  connectionId: string;
  properties: SqliteProperties;
  password?: SecretRefValue;
  readonly: boolean;
  onChange: (patch: { properties?: SqliteProperties; password?: SecretRefValue }) => void;
};

export function SqliteConnectionForm({ connectionId, properties, password, readonly, onChange }: Props): JSX.Element {
  const updateProp = (key: keyof SqliteProperties, value: unknown): void => {
    onChange({ properties: { ...properties, [key]: value } });
  };

  const id = (suffix: string): string => `sqlite-${connectionId}-${suffix}`;

  const handleBrowse = (): void => {
    void window.appShell.showDialogOpen({
      title: "Select SQLite Database File",
      filters: [
        { name: "SQLite Database", extensions: ["sqlite", "sqlite3", "db", "db3", "s3db", "sl3"] },
        { name: "All Files", extensions: ["*"] }
      ]
    }).then((result) => {
      if (!result.canceled && result.filePaths.length > 0) {
        updateProp("filePath", result.filePaths[0]);
      }
    });
  };

  return (
    <>
      <div className="jdbc-settings-cell">
        <span className="jdbc-settings-help">
          Requires <code>sqlite-jdbc-*.jar</code> from{" "}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); void window.appShell.openExternal(SQLITE_JDBC_MAVEN_URL); }}
          >
            Maven Central
          </a>
          {" "}placed in <code>libShared/</code> under the app data directory.
        </span>
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("filePath")}>
          Database File
        </label>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          <input
            id={id("filePath")}
            className="jdbc-settings-input"
            style={{ flex: 1 }}
            value={properties.filePath ?? ""}
            placeholder="/path/to/database.sqlite"
            readOnly={readonly}
            onChange={(e) => updateProp("filePath", e.target.value)}
          />
          <button
            className="jdbc-settings-button"
            disabled={readonly}
            onClick={handleBrowse}
          >
            Browse...
          </button>
        </div>
      </div>

      <div className="jdbc-settings-cell">
        <label className="jdbc-settings-label" htmlFor={id("password")}>
          Encryption Password
        </label>
        <PasswordFieldInput
          inputId={id("password")}
          valueRef={password}
          readonly={readonly}
          onChangeRef={(nextRef) => onChange({ password: nextRef })}
        />
      </div>
    </>
  );
}
