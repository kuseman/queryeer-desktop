import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { getJdbcSessionStore, type JdbcConnectionSessionSnapshot } from "./jdbc-session-store";

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
          lastAccess
        };
      });
  }, [entries, files]);

  return (
    <div className="panel-card" style={{ height: "100%", overflow: "auto", padding: 0 }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 12,
          border: "1px solid var(--panel-border, #2f3440)"
        }}
      >
        <thead>
          <tr>
            <th style={headerCellStyle}>File</th>
            <th style={headerCellStyle}>Connection</th>
            <th style={headerCellStyle}>Session</th>
            <th style={headerCellStyle}>State</th>
            <th style={headerCellStyle}>Last access</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.fileName}-${row.connectionName}-${index}`}>
              <td style={bodyCellStyle}>
                {row.canActivate ? (
                  <button
                    type="button"
                    style={fileLinkStyle}
                    onClick={() => fileMediator.setActiveFileId(row.fileId)}
                    title={`Activate ${row.fileName}`}
                  >
                    {row.fileName}
                  </button>
                ) : (
                  <span>{row.fileName}</span>
                )}
              </td>
              <td style={bodyCellStyle}>{row.connectionName}</td>
              <td style={bodyCellStyle}>{row.sessionId}</td>
              <td style={bodyCellStyle}>{row.state}</td>
              <td style={bodyCellStyle}>{row.lastAccess}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const headerCellStyle: CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  border: "1px solid var(--panel-border, #2f3440)",
  backgroundColor: "var(--panel-header-bg, #1a1f2a)",
  fontWeight: 600
};

const bodyCellStyle: CSSProperties = {
  padding: "6px 8px",
  border: "1px solid var(--panel-border, #2f3440)",
  whiteSpace: "nowrap"
};

const fileLinkStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  margin: 0,
  color: "var(--color-accent, #4ea1ff)",
  textDecoration: "underline",
  cursor: "pointer",
  font: "inherit"
};

function resolveFileTitle(file: FileEntity): string {
  if (file.uri.startsWith("file://")) {
    return file.uri.split("/").pop() ?? file.uri;
  }
  if (file.uri.startsWith("untitled:")) {
    return file.uri.slice(8);
  }
  return file.uri;
}
