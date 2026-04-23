import { useEffect, useMemo, useRef, useState } from "react";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type { BackendGatewayStatus } from "../../contracts/backend";
import type { LayoutZone, LayoutEditorContribution } from "../../contracts/extensions/LayoutExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { WorkspaceSnapshot } from "../../contracts/workspace/WorkspaceSnapshot";
import type { ExternalFrontendPluginManifest } from "../../contracts/plugin/ExternalFrontendPluginManifest";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import type { UserKeybindingsDocument } from "../../contracts/commands/Keybindings";
import { CoreMenuBar } from "../../plugins/core.menu/MenuBar";
import type { RendererWorkspaceService } from "../workspace/workspace-service";
import { Toolbar, StatusBar, Sidebar, SidebarDivider, EditorTabs, EditorPane } from "../../plugins/core.layout";

declare global {
  interface Window {
    appShell: {
      platform: string;
      version: string;
      readFile: (uri: string) => Promise<{ success: boolean; content: string }>;
      writeFile: (uri: string, content: string) => Promise<{ success: boolean }>;
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
      showDialogMessage: (options: {
        title: string;
        message: string;
        severity?: "info" | "warning" | "error";
        detail?: string;
        options?: { label: string; value: string }[];
      }) => Promise<{ action: string }>;
      showDialogOpen: (options: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
        multiSelections?: boolean;
      }) => Promise<{ canceled: boolean; filePaths: string[] }>;
      showDialogSave: (options: {
        title?: string;
        defaultPath?: string;
        filters?: { name: string; extensions: string[] }[];
      }) => Promise<{ canceled: boolean; filePath?: string }>;
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
  const tabsRef = useRef<HTMLDivElement | null>(null);

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
    const map = new Map<string, LayoutEditorContribution>();
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

  const tooltipContributions = useMemo(
    () => [...extensions.tooltip.sections].sort((a, b) => a.order - b.order),
    [extensions.tooltip.sections]
  );

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
    fileMediator.setActiveFileId(activeFileId);
  }, [activeFileId, fileMediator, workspaceService]);

  useEffect(() => {
    if (!activeFileId || !tabsRef.current) return;
    const tab = tabsRef.current.querySelector(`[data-file-id="${CSS.escape(activeFileId)}"]`);
    if (tab) {
      tab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeFileId]);

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
      let addedFileIds: string[] = [];
      setFiles(next);
      setOpenFileIds((prev) => {
        const nextIds = new Set(next.map((file) => file.fileId));
        const retained = prev.filter((id) => nextIds.has(id));
        const added = next
          .filter((file) => !prev.includes(file.fileId))
          .map((file) => file.fileId);
        addedFileIds = added;
        return [...retained, ...added];
      });
      setActiveFileId((prev) => {
        if (addedFileIds.length > 0) {
          return addedFileIds[addedFileIds.length - 1] ?? null;
        }
        if (prev && next.some((file) => file.fileId === prev)) {
          return prev;
        }
        return next.length > 0 ? next[next.length - 1]!.fileId : null;
      });
    });
  }, [filesRegistry, setActiveFileId]);

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
        <Toolbar
          toolbarActions={toolbarActions}
          visibleZones={visibleZones}
          onToggleZone={toggleZone}
        />
      )}

      <main className="shell-layout" ref={layoutRef}>
        {visibleZones.has("primarySidebar") && (
          <Sidebar
            views={primaryViews}
            zone="primarySidebar"
            width={primarySidebarWidth}
          />
        )}

        {visibleZones.has("primarySidebar") && (
          <SidebarDivider
            target="primary"
            onResize={beginResize}
            label="Resize primary sidebar"
          />
        )}

        <section className="shell-main-area" aria-label="Main area">
          <div className="shell-main">
            <EditorTabs
              openFiles={openFiles}
              activeFileId={activeFileId}
              editorsById={editorsById}
              tabsRef={tabsRef}
              onSelectFile={setActiveFileId}
              onCloseFile={closeFile}
              tooltipContributions={tooltipContributions}
            />

            <EditorPane
              activeFile={activeFile}
              activeEditor={activeEditor}
              welcomes={welcomes}
            />
          </div>
        </section>

        {visibleZones.has("secondarySidebar") && (
          <SidebarDivider
            target="secondary"
            onResize={beginResize}
            label="Resize secondary sidebar"
          />
        )}

        {visibleZones.has("secondarySidebar") && (
          <Sidebar
            views={secondaryViews}
            zone="secondarySidebar"
            width={secondarySidebarWidth}
          />
        )}
      </main>

      {visibleZones.has("statusBar") && (
        <StatusBar
          statusItemsLeft={statusItemsLeft}
          statusItemsRight={statusItemsRight}
          executeCommand={executeCommand}
        />
      )}
    </div>
  );
}
