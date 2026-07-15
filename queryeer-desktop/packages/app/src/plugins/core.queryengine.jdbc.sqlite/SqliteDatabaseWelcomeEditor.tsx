import { useCallback, useEffect, useRef } from "react";
import { getCoreSettingsService } from "../core.settings/service";
import { JDBC_CONNECTIONS_SETTING_ID, parseJdbcConnectionDefinitions } from "../core.queryengine.jdbc/jdbc-settings";
import { initJdbcFileBinding } from "../core.queryengine.jdbc/jdbc-metadata";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { FileMediator } from "@queryeer/api/files/FileMediator";
import "../core.files/files.css";
import "../core.dialog/input-dialog.css";

type Props = {
  filePath: string;
  fileMediator: FileMediator;
  files: FilesRegistry;
  onDone: () => void;
};

export function SqliteDatabaseWelcomeEditor({ filePath, fileMediator, files, onDone }: Props): JSX.Element | null {
  const existingConnection = findExistingConnection(filePath);
  const opened = useRef(false);

  const openQueryFile = useCallback(async (connectionId: string) => {
    if (opened.current) return;
    opened.current = true;
    const fileName = filePath.replace(/^.*[/\\]/, "").replace(/\.\w+$/, "");
    const file = await fileMediator.createUntitledFile({ mimeType: "application/sql", extension: "sql", title: fileName });
    initJdbcFileBinding(file.fileId, connectionId, undefined, files);
    onDone();
  }, [filePath, fileMediator, files, onDone]);

  useEffect(() => {
    if (existingConnection) {
      void openQueryFile(existingConnection.connectionId);
    }
  }, [existingConnection, openQueryFile]);

  const handleCreateConnection = useCallback(async () => {
    const settings = getCoreSettingsService();
    if (!settings) return;
    const raw = settings.getValue(JDBC_CONNECTIONS_SETTING_ID);
    const connections = parseJdbcConnectionDefinitions(raw);
    const connectionId = crypto.randomUUID();
    const fileName = filePath.replace(/^.*[/\\]/, "").replace(/\.\w+$/, "");
    connections.push({
      connectionId,
      title: `${fileName} (SQLite)`,
      dialectId: "sqlite",
      properties: { filePath },
      enabled: true
    });
    await settings.setValue(JDBC_CONNECTIONS_SETTING_ID, connections);
    await openQueryFile(connectionId);
  }, [filePath, fileMediator, files, onDone, openQueryFile]);

  if (existingConnection)
  {
    return null;
  }

  return (
    <section className="unsupported-editor">
      <header className="unsupported-editor-header">
        <h2>SQLite Database Detected</h2>
        <p className="unsupported-editor-path">{filePath}</p>
      </header>
      <div style={{ marginTop: "14px" }}>
        <p style={{ color: "var(--text-1)", maxWidth: "70ch" }}>
          This file appears to be a SQLite database. Create a JDBC connection to run queries against it.
        </p>
        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          <button className="dialog-input-button primary" onClick={handleCreateConnection}>
            Create JDBC Connection
          </button>
          <button className="dialog-input-button" onClick={() => { opened.current = true; onDone(); }}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}

function findExistingConnection(filePath: string) {
  const settings = getCoreSettingsService();
  if (!settings) return undefined;
  const connections = parseJdbcConnectionDefinitions(settings.getValue(JDBC_CONNECTIONS_SETTING_ID));
  return connections.find((c) => c.dialectId === "sqlite" && c.properties?.filePath === filePath);
}
