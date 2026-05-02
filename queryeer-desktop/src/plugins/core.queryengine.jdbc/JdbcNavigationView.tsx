import { useEffect, useState } from "react";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import { JDBC_NAV_DB_KEY } from "./jdbc-navigation-types";
import { getJdbcNavigationStore } from "./jdbc-navigation-store";
import { JdbcConnectionSelector } from "./JdbcConnectionSelector";
import { JdbcNavigationTree } from "./JdbcNavigationTree";
import "./jdbc-navigation.css";

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
  const connectionId = activeFile?.engineBinding?.connectionId;
  const selectedDatabase =
    activeFileId
      ? (context.files.getEditorState(activeFileId, JDBC_NAV_DB_KEY) as string | undefined)
      : undefined;

  return (
    <div className="jdbc-nav-view">
      {activeFileId ? (
        <JdbcConnectionSelector
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
