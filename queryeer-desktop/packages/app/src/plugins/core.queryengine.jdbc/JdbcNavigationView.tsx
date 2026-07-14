import { useEffect, useState } from "react";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { getJdbcNavigationStore } from "./jdbc-navigation-store";
import { JdbcConnectionSelector } from "./JdbcConnectionSelector";
import { JdbcNavigationTree } from "./JdbcNavigationTree";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import "./jdbc-navigation.css";

function resolveSelectedDatabase(
  files: PluginContext["files"],
  fileId: string | null,
  connectionId: string | undefined
): string | undefined {
  if (!fileId || !connectionId) return undefined;
  const raw = files.getEditorState(fileId, JDBC_NAV_DB_KEY);
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).connectionId === connectionId &&
    typeof (raw as Record<string, unknown>).database === "string"
  ) {
    return (raw as JdbcSelectedDatabase).database;
  }
  return undefined;
}

type Props = {
  context: PluginContext;
};

export function JdbcNavigationView({ context }: Props) {
  const [activeFileId, setActiveFileId] = useState<string | null>(() =>
    context.fileMediator.getActiveFileId()
  );

  useEffect(() => {
    return context.fileMediator.onActiveFileChanged((fileId) => setActiveFileId(fileId));
  }, [context.fileMediator]);

  const store = getJdbcNavigationStore();
  const activeFile = activeFileId ? context.files.getFile(activeFileId) : undefined;
  const connectionId = getConfiguredJdbcConnections().find(
    (connection) => connection.enabled && connection.connectionId === activeFile?.engineBinding?.connectionId
  )?.connectionId;
  const selectedDatabase = resolveSelectedDatabase(context.files, activeFileId, connectionId);

  return (
    <div className="jdbc-nav-view">
      {activeFileId ? (
        <JdbcConnectionSelector
          key={activeFileId}
          fileId={activeFileId}
          fileMediator={context.fileMediator}
          filesRegistry={context.files}
        />
      ) : (
        <div className="jdbc-nav-empty">Open a SQL file to configure connections.</div>
      )}
      <JdbcNavigationTree
        store={store}
        activeFileConnectionId={connectionId}
        activeFileDatabase={selectedDatabase}
      />
    </div>
  );
}
