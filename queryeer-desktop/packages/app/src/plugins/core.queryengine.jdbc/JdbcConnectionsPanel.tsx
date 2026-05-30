import { useEffect, useMemo, useRef, useState } from "react";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { FileMediator } from "@queryeer/api/files/FileMediator";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { getJdbcSessionStore, type JdbcConnectionSessionSnapshot } from "./jdbc-session-store";
import "./JdbcConnectionsPanel.css";

type JdbcConnectionsPanelProps = {
  files: FilesRegistry;
  fileMediator: FileMediator;
};

type Row = {
  fileId: string;
  fileName: string;
  canActivate: boolean;
  connectionName: string;
  sessionId: string;
  state: string;
  lastAccess: string;
  canForceClose: boolean;
};

export function JdbcConnectionsPanel({ files, fileMediator }: JdbcConnectionsPanelProps) {
  const [entries, setEntries] = useState<JdbcConnectionSessionSnapshot[]>(() =>
    getJdbcSessionStore().getState().entries
  );
  const fileNameCacheRef = useRef(new Map<string, string>());

  useEffect(() => {
    return getJdbcSessionStore().subscribe((state) => {
      setEntries(state.entries);
    });
  }, []);

  const rows = useMemo<Row[]>(() => {
    const connectionTitles = new Map(
      getConfiguredJdbcConnections().map((entry) => [entry.connectionId, entry.title?.trim() || entry.connectionId])
    );
    return [...entries]
      .sort((a, b) => {
        const byState = (a.status === "dead" ? 1 : 0) - (b.status === "dead" ? 1 : 0);
        if (byState !== 0) {
          return byState;
        }
        return a.fileId.localeCompare(b.fileId);
      })
      .map((entry) => {
        const file = files.getFile(entry.fileId);
        if (file) {
          fileNameCacheRef.current.set(entry.fileId, resolveFileTitle(file));
        }
        const fileName = file ? resolveFileTitle(file) : fileNameCacheRef.current.get(entry.fileId) || entry.fileId;
        const connectionName = connectionTitles.get(entry.connectionId) || entry.connectionId;
        const sessionId = entry.sessionId && entry.sessionId.length > 0 ? entry.sessionId : "-";
        const lastAccess =
          typeof entry.lastAccessTimeMs === "number" && Number.isFinite(entry.lastAccessTimeMs)
            ? new Date(entry.lastAccessTimeMs).toLocaleTimeString()
            : "-";
        return {
          fileId: entry.fileId,
          fileName,
          canActivate: Boolean(file),
          connectionName,
          sessionId,
          state: entry.status || "alive",
          lastAccess,
          canForceClose: entry.status !== "dead"
        };
      });
  }, [entries, files]);

  const handleForceClose = async (row: Row): Promise<void> => {
    await getJdbcSessionStore().forceClose(row.fileId);
  };

  return (
    <div className="jdbc-sessions-panel">
      <table className="jdbc-sessions-panel__table">
        <thead>
          <tr>
            <th className="jdbc-sessions-panel__header">File</th>
            <th className="jdbc-sessions-panel__header">Connection</th>
            <th className="jdbc-sessions-panel__header">Session</th>
            <th className="jdbc-sessions-panel__header">State</th>
            <th className="jdbc-sessions-panel__header">Last access</th>
            <th className="jdbc-sessions-panel__header">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.fileName}-${row.connectionName}-${index}`} className="jdbc-sessions-panel__row">
              <td className="jdbc-sessions-panel__cell">
                {row.canActivate ? (
                  <button
                    type="button"
                    className="jdbc-sessions-panel__file-link"
                    onClick={() => fileMediator.setActiveFileId(row.fileId)}
                    title={`Activate ${row.fileName}`}
                  >
                    {row.fileName}
                  </button>
                ) : (
                  <span>{row.fileName}</span>
                )}
              </td>
              <td className="jdbc-sessions-panel__cell">{row.connectionName}</td>
              <td className="jdbc-sessions-panel__cell">{row.sessionId}</td>
              <td className={`jdbc-sessions-panel__cell${row.state === "dead" ? " jdbc-sessions-panel__state--dead" : ""}`}>{row.state}</td>
              <td className="jdbc-sessions-panel__cell">{row.lastAccess}</td>
              <td className="jdbc-sessions-panel__cell">
                <button
                  type="button"
                  className="jdbc-sessions-panel__force-close"
                  disabled={!row.canForceClose}
                  onClick={() => void handleForceClose(row)}
                  title="Force close this JDBC session connection"
                >
                  Force close
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function resolveFileTitle(file: FileEntity): string {
  if (file.uri.startsWith("file://")) {
    return file.uri.split("/").pop() ?? file.uri;
  }
  if (file.uri.startsWith("untitled:")) {
    return decodeURIComponent(file.uri.slice(8));
  }
  return file.uri;
}
