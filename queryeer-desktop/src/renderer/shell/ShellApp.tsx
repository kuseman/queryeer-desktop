import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";
import type { PluginHostState } from "../../core/plugin-runtime/PluginHost";
import type { BackendGatewayStatus } from "../../contracts/backend";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { ExternalFrontendPluginManifest } from "../../contracts/plugin/ExternalFrontendPluginManifest";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import { GenericActionIcon, layoutToolbarIconMap } from "../icons/LayoutIcons";

declare global {
  interface Window {
    appShell: {
      platform: string;
      version: string;
      getBackendStatus: () => Promise<BackendGatewayStatus>;
      getExternalFrontendPlugins: () => Promise<ExternalFrontendPluginManifest[]>;
      executeBackendQuery: (params: {
        queryExecutionId: string;
        engineId: string;
        text: string;
      }) => Promise<{ accepted: boolean; queryExecutionId: string }>;
      cancelBackendQuery: (params: {
        queryExecutionId: string;
        reason?: string;
      }) => Promise<{ accepted: boolean; queryExecutionId: string }>;
      openBackendFile: (params: {
        fileId: string;
        uri: string;
        mimeType: string;
        engineBinding?: { engineId: string; connectionId?: string };
        initialText?: string;
      }) => Promise<{ fileId: string; backendVersion: number }>;
      closeBackendFile: (params: {
        fileId: string;
      }) => Promise<{ fileId: string; accepted: boolean }>;
      bindBackendFile: (params: {
        fileId: string;
        engineId: string;
        connectionId?: string;
      }) => Promise<{ fileId: string; engineId: string; backendVersion: number }>;
      notifyBackendFileChange: (params: {
        fileId: string;
        version: number;
        text: string;
      }) => Promise<void>;
      watchFile: (params: {
        uri: string;
        options: { recursive?: boolean };
      }) => Promise<{ subscriptionId: string }>;
      unwatchFile: (params: { subscriptionId: string }) => Promise<{ removed: boolean }>;
      muteFileWatcherPath: (params: {
        uri: string;
        durationMs: number;
      }) => Promise<{ muted: boolean }>;
      onFileWatcherEvent: (
        listener: (params: {
          subscriptionId: string;
          event: {
            type: "add" | "modify" | "delete" | "rename";
            uri: string;
            timestamp: string;
          };
        }) => void
      ) => () => void;
    };
  }
}

type ShellAppProps = {
  hostState: PluginHostState;
  extensions: ExtensionSnapshot;
  filesRegistry: FilesRegistry;
  fileMediator: FileMediator;
  commandExecution: CommandExecutionResult;
  diagnostics: PluginDiagnostics;
};

export function ShellApp({
  hostState,
  extensions,
  filesRegistry,
  fileMediator,
  commandExecution,
  diagnostics
}: ShellAppProps): JSX.Element {
  const [backendStatus, setBackendStatus] = useState<BackendGatewayStatus | null>(null);
  const [zoneOverrides, setZoneOverrides] = useState<
    Partial<Record<"menuBar" | "toolBar" | "statusBar" | "primarySidebar" | "secondarySidebar" | "mainArea", boolean>>
  >({});
  const [primarySidebarWidth, setPrimarySidebarWidth] = useState(
    extensions.layout.shellDefaults.sidebarWidths?.primary ?? 280
  );
  const [secondarySidebarWidth, setSecondarySidebarWidth] = useState(
    extensions.layout.shellDefaults.sidebarWidths?.secondary ?? 320
  );
  const [files, setFiles] = useState<FileEntity[]>(() => filesRegistry.listFiles());
  const [openFileIds, setOpenFileIds] = useState<string[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const layoutRef = useRef<HTMLElement | null>(null);

  const defaultVisibleZones = useMemo(() => {
    const defaults = extensions.layout.shellDefaults.visibleZones;
    const zones = new Set(
      defaults.length > 0
        ? defaults
        : ["menuBar", "toolBar", "statusBar", "primarySidebar", "mainArea"]
    );

    if (extensions.layout.views.some((view) => view.defaultZone === "secondarySidebar")) {
      zones.add("secondarySidebar");
    }

    if (extensions.layout.views.some((view) => view.defaultZone === "primarySidebar")) {
      zones.add("primarySidebar");
    }

    zones.add("mainArea");
    zones.add("statusBar");
    return zones;
  }, [extensions.layout.shellDefaults.visibleZones, extensions.layout.views]);

  const visibleZones = useMemo(() => {
    const zones = new Set(defaultVisibleZones);
    for (const [zone, visible] of Object.entries(zoneOverrides)) {
      if (visible === undefined) {
        continue;
      }
      if (visible) {
        zones.add(zone as keyof typeof zoneOverrides);
      } else {
        zones.delete(zone as keyof typeof zoneOverrides);
      }
    }
    zones.add("mainArea");
    zones.add("statusBar");
    return zones;
  }, [defaultVisibleZones, zoneOverrides]);

  const toggleZone = (zone: "primarySidebar" | "secondarySidebar") => {
    setZoneOverrides((previous) => {
      const currentlyVisible = previous[zone] ?? defaultVisibleZones.has(zone);
      return {
        ...previous,
        [zone]: !currentlyVisible
      };
    });
  };

  const zoneToggleByCommand: Record<string, "primarySidebar" | "secondarySidebar" | undefined> = {
    "core.layout.togglePrimarySidebar": "primarySidebar",
    "core.layout.toggleSecondarySidebar": "secondarySidebar"
  };

  const isZoneVisible = (zone: "primarySidebar" | "secondarySidebar") => {
    return visibleZones.has(zone);
  };

  const renderToolbarIcon = (icon: string | undefined) => {
    if (!icon) {
      return <GenericActionIcon className="shell-toolbar-icon" />;
    }
    const IconComponent = layoutToolbarIconMap[icon] ?? GenericActionIcon;
    return <IconComponent className="shell-toolbar-icon" />;
  };

  const menuItems = useMemo(
    () => [...extensions.layout.menuItems].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.menuItems]
  );

  const toolbarActions = useMemo(
    () => [...extensions.layout.toolbarActions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.toolbarActions]
  );

  const statusItemsLeft = useMemo(
    () =>
      [...extensions.layout.statusItems]
        .filter((item) => (item.alignment ?? "left") === "left")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.statusItems]
  );

  const statusItemsRight = useMemo(
    () =>
      [...extensions.layout.statusItems]
        .filter((item) => item.alignment === "right")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.statusItems]
  );

  const primaryViews = useMemo(
    () =>
      [...extensions.layout.views]
        .filter((view) => view.defaultZone === "primarySidebar")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.views]
  );

  const secondaryViews = useMemo(
    () =>
      [...extensions.layout.views]
        .filter((view) => view.defaultZone === "secondarySidebar")
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.views]
  );

  const welcomes = useMemo(
    () => [...extensions.layout.welcomes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.welcomes]
  );

  const editors = useMemo(
    () => [...extensions.layout.editors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [extensions.layout.editors]
  );

  const editorsById = useMemo(() => {
    const map = new Map<string, (typeof editors)[number]>();
    for (const editor of editors) {
      map.set(editor.id, editor);
    }
    return map;
  }, [editors]);

  const openFiles = useMemo(
    () =>
      openFileIds
        .map((id) => files.find((file) => file.fileId === id))
        .filter((file): file is FileEntity => Boolean(file)),
    [openFileIds, files]
  );

  const activeFile = useMemo(
    () => {
      if (!activeFileId) return null;
      return files.find((file) => file.fileId === activeFileId) ?? null;
    },
    [activeFileId, files]
  );

  const activeEditor = useMemo(() => {
    if (!activeFile?.editorId) return null;
    return editorsById.get(activeFile.editorId) ?? null;
  }, [activeFile, editorsById]);

  const closeFile = (fileId: string) => {
    setOpenFileIds((prev) => {
      const next = prev.filter((id) => id !== fileId);
      if (activeFileId === fileId) {
        setActiveFileId(next.length > 0 ? next[next.length - 1]! : null);
      }
      return next;
    });
    void fileMediator.closeFile(fileId, { discardDirty: true });
  };

  const platformLabel = useMemo(() => {
    const platform = window.appShell?.platform;
    if (!platform) {
      return "unknown";
    }
    return platform;
  }, []);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const status = await window.appShell.getBackendStatus();
      if (active) {
        setBackendStatus(status);
      }
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (editors.length === 0) {
      return;
    }
    if (filesRegistry.listFiles().length > 0) {
      return;
    }
    const firstEditor = editors[0]!;
    void fileMediator.openFile(`untitled:${firstEditor.id}`, {
      editorId: firstEditor.id
    });
  }, [editors, filesRegistry, fileMediator]);

  useEffect(() => {
    return filesRegistry.subscribe((next) => {
      setFiles(next);
      setOpenFileIds((prev) => {
        const nextIds = new Set(next.map((file) => file.fileId));
        const retained = prev.filter((id) => nextIds.has(id));
        const added = next
          .filter((file) => !prev.includes(file.fileId))
          .map((file) => file.fileId);
        return [...retained, ...added];
      });
      setActiveFileId((prev) => {
        if (prev && next.some((file) => file.fileId === prev)) {
          return prev;
        }
        return next.length > 0 ? next[next.length - 1]!.fileId : null;
      });
    });
  }, [filesRegistry]);

  const beginResize = (target: "primary" | "secondary") => {
    const onMouseMove = (event: MouseEvent) => {
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }

      const rect = layout.getBoundingClientRect();
      if (target === "primary") {
        const nextWidth = Math.max(180, Math.min(520, event.clientX - rect.left));
        setPrimarySidebarWidth(nextWidth);
      } else {
        const nextWidth = Math.max(180, Math.min(520, rect.right - event.clientX));
        setSecondarySidebarWidth(nextWidth);
      }
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("is-resizing-layout");
    };

    document.body.classList.add("is-resizing-layout");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  return (
    <div className="shell-page">
      {visibleZones.has("menuBar") && (
        <header className="shell-topbar shell-menu-bar">
          <div className="shell-menu-brand">
            <span className="shell-brand">Queryeer</span>
            <span className="shell-chip">Desktop Shell</span>
          </div>
          <nav className="shell-menu-items" aria-label="Menu bar">
            {menuItems.map((item) => (
              <button key={item.id} type="button" className="shell-menu-item">
                {item.label}
              </button>
            ))}
          </nav>
        </header>
      )}

      {visibleZones.has("toolBar") && (
        <section className="shell-toolbar" aria-label="Tool bar">
          {toolbarActions.length === 0 ? (
            <span className="shell-toolbar-empty">No toolbar actions contributed yet.</span>
          ) : (
            toolbarActions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={`shell-toolbar-action ${
                  zoneToggleByCommand[action.commandId] &&
                  isZoneVisible(zoneToggleByCommand[action.commandId] as "primarySidebar" | "secondarySidebar")
                    ? "is-active"
                    : ""
                }`}
                title={action.title}
                aria-pressed={
                  zoneToggleByCommand[action.commandId]
                    ? isZoneVisible(zoneToggleByCommand[action.commandId] as "primarySidebar" | "secondarySidebar")
                    : undefined
                }
                onClick={() => {
                  if (action.commandId === "core.layout.togglePrimarySidebar") {
                    toggleZone("primarySidebar");
                    return;
                  }
                  if (action.commandId === "core.layout.toggleSecondarySidebar") {
                    toggleZone("secondarySidebar");
                    return;
                  }
                }}
              >
                {renderToolbarIcon(action.icon)}
                <span>{action.title}</span>
              </button>
            ))
          )}
        </section>
      )}

      <main className="shell-layout" ref={layoutRef}>
        {visibleZones.has("primarySidebar") && (
          <aside
            className="shell-sidebar shell-sidebar-primary"
            aria-label="Primary sidebar"
            style={{ width: `${primarySidebarWidth}px` }}
          >
            {primaryViews.map((view) => (
              <section key={view.id} className="panel-card">
                <h3>{view.title}</h3>
                {view.render()}
              </section>
            ))}
          </aside>
        )}

        {visibleZones.has("primarySidebar") && (
          <div
            className="shell-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize primary sidebar"
            onMouseDown={() => beginResize("primary")}
          />
        )}

        <section className="shell-main-area" aria-label="Main area">
          <div className="shell-main">
            {openFiles.length > 0 ? (
              <div className="shell-editor-tabs">
                {openFiles.map((file) => {
                  const editor = file.editorId ? editorsById.get(file.editorId) : undefined;
                  const title = editor?.title ?? file.uri;
                  const dirtyMark = file.dirtyVsDisk || file.dirtyVsBackend ? " •" : "";
                  return (
                    <div
                      key={file.fileId}
                      className={`shell-editor-tab ${
                        activeFileId === file.fileId ? "is-active" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="shell-editor-tab-button"
                        onClick={() => setActiveFileId(file.fileId)}
                      >
                        <span className="shell-editor-tab-title">{`${title}${dirtyMark}`}</span>
                        <button
                          type="button"
                          className="shell-editor-tab-close"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeFile(file.fileId);
                          }}
                          aria-label={`Close ${title}`}
                        >
                          ×
                        </button>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="shell-editor-content">
              {activeEditor ? (
                <div className="shell-editor-pane">{activeEditor.render()}</div>
              ) : (
                <>
                  <h1>Incremental migration starting point</h1>
                  <p>
                    Fixed shell zones are active. Legacy panel extensions are still
                    rendered for compatibility while layout view/editor migration
                    is in progress.
                  </p>

                  {welcomes.map((welcome) => (
                    <article
                      key={welcome.id}
                      className="panel-card panel-card-wide"
                    >
                      {welcome.render()}
                    </article>
                  ))}
                </>
              )}
            </div>

            <section className="shell-status">
          <div>
            <span className="label">Platform</span>
            <span className="value">{platformLabel}</span>
          </div>
          <div>
            <span className="label">Shell version</span>
            <span className="value">{window.appShell?.version ?? "n/a"}</span>
          </div>
          <div>
            <span className="label">Loaded plugins</span>
            <span className="value">{hostState.loadedPluginIds.length}</span>
          </div>
          <div>
            <span className="label">Host started at</span>
            <span className="value">{hostState.startedAt}</span>
          </div>
          <div>
            <span className="label">Command bus probe</span>
            <span className="value">
              {commandExecution.executed
                ? `ok (${commandExecution.commandId})`
                : `failed (${commandExecution.reason ?? "unknown"})`}
            </span>
          </div>
          <div>
            <span className="label">Backend state</span>
            <span className="value">{backendStatus?.state ?? "loading"}</span>
          </div>
            </section>

            <section className="shell-runtime-grid">
          <article className="panel-card">
            <h2>Plugins</h2>
            <ul>
              {hostState.loadedPluginIds.map((pluginId) => (
                <li key={pluginId}>{pluginId}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Commands</h2>
            <ul>
              {extensions.commands.map((command) => (
                <li key={command.id}>{command.id}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Filesystems</h2>
            <ul>
              {extensions.filesystems.map((filesystem) => (
                <li key={filesystem.id}>{filesystem.title}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Activation order</h2>
            <ul>
              {diagnostics.activationOrder.map((pluginId) => (
                <li key={pluginId}>{pluginId}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card">
            <h2>Capabilities</h2>
            <ul>
              {diagnostics.providedCapabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </article>

          <article className="panel-card panel-card-wide">
            <h2>Manifest diagnostics</h2>
            <div className="manifest-grid-head">
              <span>Plugin</span>
              <span>Module path</span>
              <span>Dependencies</span>
              <span>Required capabilities</span>
              <span>Provided capabilities</span>
            </div>
            {diagnostics.pluginManifests.map((manifest) => (
              <div className="manifest-grid-row" key={manifest.id}>
                <span>{manifest.id}</span>
                <span>{manifest.modulePath}</span>
                <span>{manifest.dependencies.join(", ") || "-"}</span>
                <span>{manifest.requiredCapabilities.join(", ") || "-"}</span>
                <span>{manifest.providesCapabilities.join(", ") || "-"}</span>
              </div>
            ))}

            <h3>External plugin load errors</h3>
            <div className="manifest-grid-head">
              <span>Plugin</span>
              <span>Module path</span>
              <span>Error</span>
              <span>-</span>
              <span>-</span>
            </div>
            {(diagnostics.externalLoadErrors ?? []).length === 0 ? (
              <div className="manifest-grid-row">
                <span>-</span>
                <span>-</span>
                <span>none</span>
                <span>-</span>
                <span>-</span>
              </div>
            ) : (
              (diagnostics.externalLoadErrors ?? []).map((error, index) => (
                <div className="manifest-grid-row" key={`${error.pluginId}-${index}`}>
                  <span>{error.pluginId}</span>
                  <span>{error.modulePath}</span>
                  <span>{error.message}</span>
                  <span>-</span>
                  <span>-</span>
                </div>
              ))
            )}
          </article>

          <article className="panel-card panel-card-wide">
            <h2>Backend gateway</h2>
            <div className="manifest-grid-head">
              <span>Mode</span>
              <span>Server</span>
              <span>Protocol</span>
              <span>Last ping</span>
              <span>RTT ms</span>
            </div>
            <div className="manifest-grid-row">
              <span>{backendStatus?.mode ?? "-"}</span>
              <span>
                {backendStatus?.serverName
                  ? `${backendStatus.serverName} ${backendStatus.serverVersion ?? ""}`
                  : "-"}
              </span>
              <span>{backendStatus?.protocolVersion ?? "-"}</span>
              <span>{backendStatus?.lastPingAt ?? "-"}</span>
              <span>
                {backendStatus?.lastPingRttMs !== undefined
                  ? String(backendStatus.lastPingRttMs)
                  : "-"}
              </span>
            </div>

            <h3>Capabilities</h3>
            <ul>
              {(backendStatus?.supportedCapabilities ?? []).map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>

            <h3>Runtime plugin status</h3>
            <div className="manifest-grid-head">
              <span>Plugin</span>
              <span>State</span>
              <span>Reason</span>
              <span>Runtime started</span>
              <span>Activated IDs</span>
            </div>
            {(backendStatus?.runtimeStatus?.pluginStatuses ?? []).map((pluginStatus, index) => (
              <div className="manifest-grid-row" key={`${pluginStatus.pluginId}-${index}`}>
                <span>{pluginStatus.pluginId}</span>
                <span>{pluginStatus.state}</span>
                <span>{pluginStatus.reason ?? "-"}</span>
                <span>{index === 0 ? backendStatus?.runtimeStatus?.startedAt ?? "-" : ""}</span>
                <span>
                  {index === 0
                    ? (backendStatus?.runtimeStatus?.activatedPluginIds ?? []).join(", ") || "-"
                    : ""}
                </span>
              </div>
            ))}

            <h3>Recent executions</h3>
            <div className="manifest-grid-head">
              <span>Execution</span>
              <span>Engine</span>
              <span>State</span>
              <span>Progress</span>
              <span>Chunks/Rows</span>
            </div>
            {(backendStatus?.recentExecutions ?? []).map((execution) => (
              <div className="manifest-grid-row" key={execution.queryExecutionId}>
                <span>{execution.queryExecutionId}</span>
                <span>{execution.engineId ?? "-"}</span>
                <span>{execution.state}</span>
                <span>
                  {execution.progressPercent !== undefined
                    ? `${execution.progressPercent}% ${execution.progressMessage ?? ""}`
                    : "-"}
                </span>
                <span>{`${execution.chunks}/${execution.rows}`}</span>
              </div>
            ))}

            <h3>Error</h3>
            <p>{backendStatus?.error ?? "none"}</p>

            <h3>Backend log panel</h3>
            <div className="backend-log-panel">
              {(backendStatus?.backendLogs ?? []).length === 0 ? (
                <p className="backend-log-empty">No backend logs yet.</p>
              ) : (
                <ul className="backend-log-list">
                  {(backendStatus?.backendLogs ?? []).map((entry, index) => (
                    <li key={`${entry.timestamp}-${index}`} className={`backend-log-${entry.level}`}>
                      <span className="backend-log-time">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="backend-log-level">{entry.level}</span>
                      <span className="backend-log-source">{entry.source}</span>
                      <span className="backend-log-message">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>
            </section>

          </div>
        </section>

        {visibleZones.has("secondarySidebar") && (
          <div
            className="shell-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize secondary sidebar"
            onMouseDown={() => beginResize("secondary")}
          />
        )}

        {visibleZones.has("secondarySidebar") && (
          <aside
            className="shell-sidebar shell-sidebar-secondary"
            aria-label="Secondary sidebar"
            style={{ width: `${secondarySidebarWidth}px` }}
          >
            {secondaryViews.map((view) => (
              <section key={view.id} className="panel-card">
                <h3>{view.title}</h3>
                {view.render()}
              </section>
            ))}
          </aside>
        )}
      </main>

      {visibleZones.has("statusBar") && (
        <footer className="shell-status-bar" aria-label="Status bar">
          <div className="shell-status-bar-left">
            {statusItemsLeft.map((item) => (
              <div key={item.id} className="shell-status-item">
                {item.render()}
              </div>
            ))}
          </div>
          <div className="shell-status-bar-right">
            <span className="shell-status-item">Backend: {backendStatus?.state ?? "loading"}</span>
            {statusItemsRight.map((item) => (
              <div key={item.id} className="shell-status-item">
                {item.render()}
              </div>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}
