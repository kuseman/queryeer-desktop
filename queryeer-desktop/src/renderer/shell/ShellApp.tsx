import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { BackendGatewayStatus } from "../../contracts/backend";
import type { LayoutZone, LayoutStatusItemContribution } from "../../contracts/extensions/LayoutExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { WorkspaceSnapshot } from "../../contracts/workspace/WorkspaceSnapshot";
import type { ExternalFrontendPluginManifest } from "../../contracts/plugin/ExternalFrontendPluginManifest";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import type { UserKeybindingsDocument } from "../../contracts/commands/Keybindings";
import { CoreMenuBar } from "../../plugins/core.menu/MenuBar";
import type { RendererWorkspaceService } from "../workspace/workspace-service";
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
      getWorkspace: () => Promise<WorkspaceSnapshot>;
      saveWorkspace: (snapshot: WorkspaceSnapshot) => Promise<{ accepted: boolean }>;
      getUserKeybindings: () => Promise<UserKeybindingsDocument>;
      saveUserKeybindings: (document: UserKeybindingsDocument) => Promise<{ accepted: boolean }>;
      saveWorkspaceBackup: (params: {
        fileId: string;
        text: string;
      }) => Promise<{ backupUri: string }>;
      purgeWorkspaceBackups: (params: { fileId: string }) => Promise<{ purged: number }>;
      listWorkspaceBackups: (params: {
        fileId: string;
      }) => Promise<{ backupPaths: string[] }>;
      readLatestWorkspaceBackup: (params: {
        fileId: string;
      }) => Promise<{ text: string; savedAt: string; backupUri: string } | null>;
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
buildMenu: (menuItems: unknown[], commands: unknown[]) => Promise<{ success: boolean }>;
      windowMinimize: () => void;
      windowMaximize: () => void;
      windowClose: () => void;
      isWindowMaximized: () => Promise<boolean>;
      onWindowStateChanged: (listener: (state: { maximized: boolean }) => void) => () => void;
      onMenuExecuteCommand: (listener: (commandId: string) => void) => () => void;
    };
  }
}

type ShellAppProps = {
  extensions: ExtensionSnapshot;
  filesRegistry: FilesRegistry;
  fileMediator: FileMediator;
  workspaceService: RendererWorkspaceService;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
};

export function ShellApp({
  extensions,
  filesRegistry,
  fileMediator,
  workspaceService,
  executeCommand
}: ShellAppProps): JSX.Element {
  const [visibleZones, setVisibleZones] = useState<Set<LayoutZone>>(() => {
    const restored = workspaceService.restoredLayout()?.visibleZones;
    if (restored) {
      const set = new Set<LayoutZone>(restored);
      set.add("mainArea");
      set.add("statusBar");
      return set;
    }
    const defaults = extensions.layout.shellDefaults.visibleZones;
    const set = new Set<LayoutZone>(
      defaults.length > 0
        ? defaults
        : ["menuBar", "toolBar", "statusBar", "primarySidebar", "mainArea"]
    );
    if (extensions.layout.views.some((view) => view.defaultZone === "secondarySidebar")) {
      set.add("secondarySidebar");
    }
    if (extensions.layout.views.some((view) => view.defaultZone === "primarySidebar")) {
      set.add("primarySidebar");
    }
    set.add("mainArea");
    set.add("statusBar");
    return set;
  });
  const [primarySidebarWidth, setPrimarySidebarWidth] = useState(
    () =>
      workspaceService.restoredLayout()?.sidebarWidths?.primary ??
      extensions.layout.shellDefaults.sidebarWidths?.primary ??
      280
  );
  const [secondarySidebarWidth, setSecondarySidebarWidth] = useState(
    () =>
      workspaceService.restoredLayout()?.sidebarWidths?.secondary ??
      extensions.layout.shellDefaults.sidebarWidths?.secondary ??
      320
  );
  const [files, setFiles] = useState<FileEntity[]>(() => filesRegistry.listFiles());
  const [openFileIds, setOpenFileIds] = useState<string[]>(() =>
    filesRegistry.listFiles().map((file) => file.fileId)
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(
    () => workspaceService.restoredActiveFileId() ?? filesRegistry.listFiles()[0]?.fileId ?? null
  );
  const layoutRef = useRef<HTMLElement | null>(null);

  const toggleZone = (zone: LayoutZone) => {
    setVisibleZones((previous) => {
      const next = new Set(previous);
      if (next.has(zone)) {
        next.delete(zone);
      } else {
        next.add(zone);
      }
      next.add("mainArea");
      next.add("statusBar");
      return next;
    });
  };

  const zoneToggleByCommand: Record<string, "primarySidebar" | "secondarySidebar" | undefined> = {
    "core.layout.togglePrimarySidebar": "primarySidebar",
    "core.layout.toggleSecondarySidebar": "secondarySidebar"
  };

  const isZoneVisible = (zone: LayoutZone) => {
    return visibleZones.has(zone);
  };

  const renderToolbarIcon = (icon: string | undefined) => {
    if (!icon) {
      return <GenericActionIcon className="shell-toolbar-icon" />;
    }
    const IconComponent = layoutToolbarIconMap[icon] ?? GenericActionIcon;
    return <IconComponent className="shell-toolbar-icon" />;
  };

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

  useEffect(() => {
    workspaceService.setActiveFileId(activeFileId);
  }, [activeFileId, workspaceService]);

  useEffect(() => {
    workspaceService.setLayout({
      visibleZones: [...visibleZones],
      sidebarWidths: {
        primary: primarySidebarWidth,
        secondary: secondarySidebarWidth
      }
    });
  }, [visibleZones, primarySidebarWidth, secondarySidebarWidth, workspaceService]);

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
      <CoreMenuBar
        menuItems={extensions.menu.items}
        keybindings={extensions.keybindings}
        executeCommand={executeCommand}
      />
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
                      <div
                        role="button"
                        className="shell-editor-tab-button"
                        onClick={() => setActiveFileId(file.fileId)}
                      >
                        <span className="shell-editor-tab-title">{`${title}${dirtyMark}`}</span>
                      </div>
                      <span
                        role="button"
                        className="shell-editor-tab-close"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeFile(file.fileId);
                        }}
                        aria-label={`Close ${title}`}
                      >
                        ×
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="shell-editor-content">
              {activeEditor ? (
                <div className="shell-editor-pane">{activeEditor.render()}</div>
              ) : welcomes.length > 0 ? (
                welcomes.map((welcome) => (
                  <article
                    key={welcome.id}
                    className="panel-card panel-card-wide"
                  >
                    {welcome.render()}
                  </article>
                ))
              ) : null}
            </div>
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
                <StatusItemContent item={item} executeCommand={executeCommand} />
              </div>
            ))}
          </div>
          <div className="shell-status-bar-right">
            {statusItemsRight.map((item) => (
              <div key={item.id} className="shell-status-item">
                <StatusItemContent item={item} executeCommand={executeCommand} />
              </div>
            ))}
          </div>
        </footer>
      )}
    </div>
  );
}

function StatusItemContent({
  item,
  executeCommand
}: {
  item: LayoutStatusItemContribution;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
}) {
  if (!item.commandId) {
    return <>{item.render()}</>;
  }
  return (
    <span
      role="button"
      className="shell-status-item-interactive"
      tabIndex={0}
      onClick={() => {
        void executeCommand(item.commandId!);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          void executeCommand(item.commandId!);
        }
      }}
    >
      {item.render()}
    </span>
  );
}
