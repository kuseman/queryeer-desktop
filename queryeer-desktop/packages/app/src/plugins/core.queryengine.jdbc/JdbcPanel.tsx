import { useCallback, useState } from "react";
import type { FileMediator } from "@queryeer/api/files/FileMediator";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import { JdbcConnectionsPanel } from "./JdbcConnectionsPanel";
import { JdbcSchemaCachePanel } from "./JdbcSchemaCachePanel";
import "./JdbcPanel.css";

const TAB_SESSIONS = "jdbc-panel.sessions";
const TAB_SCHEMA_CACHE = "jdbc-panel.schema-cache";

type JdbcPanelProps = {
  files: FilesRegistry;
  fileMediator: FileMediator;
};

export function JdbcPanel({ files, fileMediator }: JdbcPanelProps) {
  const [activeTab, setActiveTab] = useState(TAB_SESSIONS);

  const handleTabClick = useCallback((tabId: string) => () => {
    setActiveTab(tabId);
  }, []);

  return (
    <div className="jdbc-panel">
      <div className="jdbc-panel__tabs">
        <button
          type="button"
          className={`jdbc-panel__tab${activeTab === TAB_SESSIONS ? " jdbc-panel__tab--active" : ""}`}
          onClick={handleTabClick(TAB_SESSIONS)}
        >
          Sessions
        </button>
        <button
          type="button"
          className={`jdbc-panel__tab${activeTab === TAB_SCHEMA_CACHE ? " jdbc-panel__tab--active" : ""}`}
          onClick={handleTabClick(TAB_SCHEMA_CACHE)}
        >
          Schema Cache
        </button>
      </div>
      <div className="jdbc-panel__content">
        {activeTab === TAB_SESSIONS && <JdbcConnectionsPanel files={files} fileMediator={fileMediator} />}
        {activeTab === TAB_SCHEMA_CACHE && <JdbcSchemaCachePanel />}
      </div>
    </div>
  );
}
