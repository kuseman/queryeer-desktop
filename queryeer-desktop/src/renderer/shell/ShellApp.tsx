import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type {
  LayoutZone,
  LayoutEditorContribution
} from "../../contracts/extensions/LayoutExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FileMediator } from "../../contracts/files/FileMediator";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { CommandExecutionResult } from "../../contracts/plugin/Plugin";
import "../../contracts/shell/Api";
import { CoreMenuBar } from "../../plugins/core.menu/MenuBar";
import type { RendererWorkspaceService } from "../workspace/workspace-service";
import { Toolbar, StatusBar, Sidebar, SidebarDivider, EditorTabs, EditorPane } from "../../plugins/core.layout";
import { SettingsModalHost } from "../../plugins/core.settings/SettingsModalHost";
import { InputDialogHost } from "../../plugins/core.dialog/InputDialogHost";
import { MessageDialogHost } from "../../plugins/core.dialog/MessageDialogHost";
import { QuickCommandHost } from "../../plugins/core.quickcommand/QuickCommandHost";
import { filterMenuItemsByWhen } from "../../plugins/core.menu/menu-item-filter";
import { confirmCloseDirtyFile } from "./close-file-guard";
import { requestMessageDialog } from "../../plugins/core.dialog/message-dialog-service";
import { filterSidebarViews } from "./sidebar-view-filter";
import { filterToolbarActions } from "./toolbar-action-filter";
import { resolveFirstAcceleratorsByCommand } from "./accelerator-utils";
import { subscribeOpenPanelRequests } from "./layout-panel-events";
import { getOutlineRegistry } from "../../core/plugin-runtime/ExtensionRegistry";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../../plugins/core.settings/service";
import {
  recordTabActivation,
  resolveActiveFileAfterRegistryUpdate,
  resolveNextActiveTab,
  resolveOpenFileIds
} from "./tab-activation-queue";
import "./shell-app.css";

const OPEN_NEW_FILES_LAST_SETTING_ID = "core.files.openNewFilesLast";

export type ShellAppProps = {
  extensions: ExtensionSnapshot;
  filesRegistry: FilesRegistry;
  fileMediator: FileMediator;
  workspaceService: RendererWorkspaceService;
  executeCommand: (commandId: string) => Promise<CommandExecutionResult>;
  canExecuteCommand: (commandId: string) => boolean;
  onCommandContextChanged: (listener: () => void) => () => void;
};

export function ShellApp({
  extensions,
  filesRegistry,
  fileMediator,
  workspaceService,
  executeCommand,
  canExecuteCommand,
  onCommandContextChanged
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
    if (extensions.layout.panels.length > 0) {
      set.add("panel");
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
  const [panelStates, setPanelStates] = useState<Record<string, boolean>>(
    () =>
      workspaceService.restoredLayout()?.sidebarPanelStates ??
      {}
  );
  const [panelHeights, setPanelHeights] = useState<Record<string, number>>(
    () =>
      workspaceService.restoredLayout()?.sidebarPanelHeights ??
      {}
  );
  const [panelHeight, setPanelHeight] = useState<number>(
    () =>
      workspaceService.restoredLayout()?.panelHeight ??
      200
  );
  const [activePanelTab, setActivePanelTab] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntity[]>(() => filesRegistry.listFiles());
  const [openFileIds, setOpenFileIds] = useState<string[]>(() =>
    filesRegistry.listFiles().map((file) => file.fileId)
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(
    () => workspaceService.restoredActiveFileId() ?? filesRegistry.listFiles()[0]?.fileId ?? null
  );
  const [tabActivationQueue, setTabActivationQueue] = useState<string[]>(() => {
    const restored = workspaceService.restoredActiveFileId();
    return restored ? [restored] : [];
  });
  const tabActivationQueueRef = useRef<string[]>(tabActivationQueue);
  const activeFileIdRef = useRef<string | null>(activeFileId);
  const [, setCommandContextVersion] = useState(0);
  const [, setSettingsVersion] = useState(0);
  const layoutRef = useRef<HTMLElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const visibleZonesRef = useRef(visibleZones);
  const activePanelTabRef = useRef(activePanelTab);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    tabActivationQueueRef.current = tabActivationQueue;
  }, [tabActivationQueue]);

  useEffect(() => {
    setTabActivationQueue((previous) => recordTabActivation(previous, activeFileId));
  }, [activeFileId]);

  useEffect(() => {
    visibleZonesRef.current = visibleZones;
  }, [visibleZones]);

  useEffect(() => {
    activePanelTabRef.current = activePanelTab;
  }, [activePanelTab]);

  useEffect(() => {
    workspaceService.setActiveFileSnapshotProvider(() => activeFileIdRef.current);
  }, [workspaceService]);

  useEffect(() => {
    return onCommandContextChanged(() => {
      setCommandContextVersion((version) => version + 1);
    });
  }, [onCommandContextChanged]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    onCoreSettingsServiceInitialized((service) => {
      unsub = service.subscribe(() => {
        setSettingsVersion((version) => version + 1);
      });
    });
    return () => unsub?.();
  }, []);

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

  const viewContext = useMemo(() => {
    const activeFileForViewContext =
      activeFileId != null ? files.find((file) => file.fileId === activeFileId) : undefined;
    const hasActiveQueryExecutableFile = activeFileForViewContext
      ? filesRegistry.capabilities.hasCapability(activeFileForViewContext.mimeType, "queryexecutable")
      : false;
    const outlineSupported = activeFileForViewContext
      ? getOutlineRegistry().hasProvider(activeFileForViewContext.mimeType)
      : false;
    return {
      hasOpenFiles: openFileIds.length > 0,
      hasActiveFile: activeFileForViewContext != null,
      activeFileMimeType: activeFileForViewContext?.mimeType,
      activeFileEditorId: activeFileForViewContext?.editorId,
      hasActiveQueryExecutableFile,
      outlineSupported
    };
  }, [openFileIds.length, activeFileId, files, filesRegistry]);

  const toolbarActions = useMemo(
    () => filterToolbarActions(extensions.layout.toolbarActions, viewContext),
    [extensions.layout.toolbarActions, viewContext]
  );

  const menuItems = useMemo(
    () => filterMenuItemsByWhen(extensions.menu.items, viewContext),
    [extensions.menu.items, viewContext]
  );

  const primaryViews = useMemo(
    () => filterSidebarViews(extensions.layout.views, "primarySidebar", viewContext),
    [extensions.layout.views, viewContext]
  );

  const secondaryViews = useMemo(
    () => filterSidebarViews(extensions.layout.views, "secondarySidebar", viewContext),
    [extensions.layout.views, viewContext]
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

  const commandTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const command of extensions.commands) {
      map.set(command.id, command.title);
    }
    return map;
  }, [extensions.commands]);

  const acceleratorByCommand = useMemo(() => {
    return resolveFirstAcceleratorsByCommand(extensions.keybindings, window.appShell.platform);
  }, [extensions.layout.toolbarActions, extensions.keybindings]);

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

  const tabContextMenus = useMemo(
    () => [...extensions.layout.tabContextMenus],
    [extensions.layout.tabContextMenus]
  );

  const tabHeaderStyleContributions = useMemo(
    () => [...extensions.layout.tabHeaderStyles],
    [extensions.layout.tabHeaderStyles]
  );

  const tabTitleContributions = useMemo(
    () => [...extensions.layout.tabTitles],
    [extensions.layout.tabTitles]
  );

  const panels = useMemo(
    () => [...extensions.layout.panels].sort((a, b) => a.id.localeCompare(b.id)),
    [extensions.layout.panels]
  );

  const panelTabs = useMemo(() => {
    return panels
      .flatMap((panel) => panel.tabs)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [panels]);

  useEffect(() => {
    if (panels.length === 0) {
      return;
    }
    const candidate = panels[0]?.defaultHeight ?? 200;
    setPanelHeight(candidate);
  }, [panels]);

  useEffect(() => {
    if (panelTabs.length === 0) {
      setActivePanelTab(null);
      return;
    }
    setActivePanelTab((previous) => {
      if (previous && panelTabs.some((tab) => tab.id === previous)) {
        return previous;
      }
      return panelTabs[0]?.id ?? null;
    });
  }, [panelTabs]);

  useEffect(() => {
    return subscribeOpenPanelRequests((request) => {
      const isPanelVisible = visibleZonesRef.current.has("panel");
      const isSameTab = request.tabId ? activePanelTabRef.current === request.tabId : false;
      if (request.toggle && isPanelVisible && isSameTab) {
        setVisibleZones((previous) => {
          const next = new Set(previous);
          next.delete("panel");
          next.add("mainArea");
          next.add("statusBar");
          return next;
        });
        return;
      }
      setVisibleZones((previous) => {
        const next = new Set(previous);
        next.add("panel");
        next.add("mainArea");
        next.add("statusBar");
        return next;
      });
      if (request.tabId) {
        setActivePanelTab(request.tabId);
      }
    });
  }, []);

  const handleTabContextMenuAction = useCallback(
    (actionId: string, _file: FileEntity) => {
      void executeCommand(actionId);
    },
    [executeCommand]
  );

  const handleTabContextMenuOpen = useCallback(
    (file: FileEntity | null) => {
      fileMediator.setContextFileId(file?.fileId ?? null);
    },
    [fileMediator]
  );

  const closeFile = (fileId: string) => {
    const performClose = () => {
      setOpenFileIds((prev) => {
        const next = prev.filter((id) => id !== fileId);
        if (activeFileIdRef.current === fileId) {
          setTabActivationQueue((previousQueue) => {
            const resolution = resolveNextActiveTab({
              queue: previousQueue,
              openFileIds: next,
              excludeFileId: fileId,
              previousOpenFileIds: prev
            });
            tabActivationQueueRef.current = resolution.nextQueue;
            activeFileIdRef.current = resolution.nextActiveFileId;
            setActiveFileId(resolution.nextActiveFileId);
            return resolution.nextQueue;
          });
        } else {
          setTabActivationQueue((previousQueue) => {
            const nextQueue = previousQueue.filter((queuedId) => queuedId !== fileId);
            tabActivationQueueRef.current = nextQueue;
            return nextQueue;
          });
        }
        return next;
      });
      void fileMediator.closeFile(fileId, { discardDirty: true });
    };

    const file = filesRegistry.getFile(fileId);
    if (!file) {
      return;
    }
    void (async () => {
      const shouldClose = await confirmCloseDirtyFile(file, requestMessageDialog);
      if (!shouldClose) {
        return;
      }
      performClose();
    })();
  };

  const selectFile = (fileId: string) => {
    setTabActivationQueue((previousQueue) => {
      const nextQueue = recordTabActivation(previousQueue, fileId);
      tabActivationQueueRef.current = nextQueue;
      return nextQueue;
    });
    activeFileIdRef.current = fileId;
    setActiveFileId(fileId);
  };

  useEffect(() => {
    workspaceService.setActiveFileId(activeFileId);
    fileMediator.setActiveFileId(activeFileId);
  }, [activeFileId, fileMediator, workspaceService]);

  useEffect(() => {
    return fileMediator.onActiveFileChanged((fileId) => {
      const nextQueue = recordTabActivation(tabActivationQueueRef.current, fileId);
      tabActivationQueueRef.current = nextQueue;
      setTabActivationQueue(nextQueue);
      activeFileIdRef.current = fileId;
      setActiveFileId(fileId);
      workspaceService.setActiveFileId(fileId);
    });
  }, [fileMediator, workspaceService]);

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
      },
      sidebarPanelStates: panelStates,
      sidebarPanelHeights: panelHeights,
      panelHeight
    });
  }, [visibleZones, primarySidebarWidth, secondarySidebarWidth, panelStates, panelHeights, panelHeight, workspaceService]);

  useEffect(() => {
    return filesRegistry.subscribe((next) => {
      let nextOpenFileIds: string[] = [];
      let addedFileIds: string[] = [];
      let previousOpenFileIdsForActivation: string[] = [];
      setFiles(next);
      setTabActivationQueue((previousQueue) => {
        const nextSet = new Set(next.map((file) => file.fileId));
        const nextQueue = previousQueue.filter((queuedId) => nextSet.has(queuedId));
        tabActivationQueueRef.current = nextQueue;
        return nextQueue;
      });
      setOpenFileIds((prev) => {
        previousOpenFileIdsForActivation = prev;
        const settings = getCoreSettingsService();
        const openNewFilesLast = settings?.getValue(OPEN_NEW_FILES_LAST_SETTING_ID) !== false;
        const resolution = resolveOpenFileIds({
          previousOpenFileIds: prev,
          nextFiles: next.map((file) => ({ fileId: file.fileId, uri: file.uri })),
          openNewFilesLast,
          activeFileId: activeFileIdRef.current,
          activationQueue: tabActivationQueueRef.current
        });
        nextOpenFileIds = resolution.nextOpenFileIds;
        addedFileIds = resolution.addedFileIds;
        const uriByFileId = new Map(next.map((file) => [file.fileId, file.uri]));
        workspaceService.setOpenFileOrder(
          resolution.nextOpenFileIds
            .map((fileId) => uriByFileId.get(fileId))
            .filter((uri): uri is string => Boolean(uri))
        );
        return resolution.nextOpenFileIds;
      });
      setActiveFileId((prev) => {
        const resolution = resolveActiveFileAfterRegistryUpdate({
          previousActiveFileId: prev,
          previousOpenFileIds: previousOpenFileIdsForActivation,
          nextOpenFileIds,
          addedFileIds,
          activationQueue: tabActivationQueueRef.current
        });
        tabActivationQueueRef.current = resolution.nextQueue;
        setTabActivationQueue(resolution.nextQueue);
        activeFileIdRef.current = resolution.nextActiveFileId;
        return resolution.nextActiveFileId;
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

  const beginResizePanel = (startY: number) => {
    const startHeight = panelHeight;
    const onMouseMove = (event: MouseEvent) => {
      const deltaY = startY - event.clientY;
      const nextHeight = Math.max(100, Math.min(600, startHeight + deltaY));
      setPanelHeight(nextHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("is-resizing-panel");
    };

    document.body.classList.add("is-resizing-panel");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const showPrimarySidebar = visibleZones.has("primarySidebar");
  const showSecondarySidebar = visibleZones.has("secondarySidebar") && secondaryViews.length > 0;
  const shellGridTemplateColumns =
    showPrimarySidebar && showSecondarySidebar
      ? `${primarySidebarWidth}px 1px minmax(0, 1fr) 1px ${secondarySidebarWidth}px`
      : showPrimarySidebar
        ? `${primarySidebarWidth}px 1px minmax(0, 1fr)`
        : showSecondarySidebar
          ? `minmax(0, 1fr) 1px ${secondarySidebarWidth}px`
          : "minmax(0, 1fr)";

  return (
    <div className="shell-page">
      <CoreMenuBar
        menuItems={menuItems}
        keybindings={extensions.keybindings}
        executeCommand={executeCommand}
        canExecuteCommand={canExecuteCommand}
        getMimeIcon={filesRegistry.mimeIcons.getMimeIcon}
      />
      {visibleZones.has("toolBar") && (
        <Toolbar
          toolbarActions={toolbarActions}
          visibleZones={visibleZones}
          onToggleZone={toggleZone}
          canExecuteCommand={canExecuteCommand}
          executeCommand={executeCommand}
          getCommandTitle={(commandId) => commandTitleById.get(commandId)}
          getCommandAccelerator={(commandId) => acceleratorByCommand.get(commandId)}
        />
      )}

      <main className="shell-layout" ref={layoutRef} style={{ gridTemplateColumns: shellGridTemplateColumns }}>
        {showPrimarySidebar && (
          <Sidebar
            views={primaryViews}
            zone="primarySidebar"
            width={primarySidebarWidth}
            panelStates={panelStates}
            panelHeights={panelHeights}
            onPanelStateChange={(viewId, isOpen) =>
              setPanelStates((prev) => ({ ...prev, [viewId]: isOpen }))
            }
            onPanelResize={(viewId, height) =>
              setPanelHeights((prev) => ({ ...prev, [viewId]: height }))
            }
            onExecuteCommand={(commandId) => {
              void executeCommand(commandId);
            }}
            canExecuteCommand={canExecuteCommand}
          />
        )}

        {showPrimarySidebar && (
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
              onSelectFile={selectFile}
              onCloseFile={closeFile}
              tooltipContributions={tooltipContributions}
              tabContextMenus={tabContextMenus}
              tabHeaderStyleContributions={tabHeaderStyleContributions}
              tabTitleContributions={tabTitleContributions}
              hasMimeCapability={(mimeType, capability) =>
                filesRegistry.capabilities.hasCapability(mimeType, capability)
              }
              getMimeIcon={filesRegistry.mimeIcons.getMimeIcon}
              onTabContextMenuAction={handleTabContextMenuAction}
              onTabContextMenuOpen={handleTabContextMenuOpen}
              tabBackgroundOpacity={(() => {
                const settings = getCoreSettingsService();
                const raw = settings?.getValue("core.files.tabBackgroundOpacity");
                return typeof raw === "number" && !Number.isNaN(raw) ? raw : undefined;
              })()}
            />

            <EditorPane
              activeFile={activeFile}
              activeEditor={activeEditor}
              welcomes={welcomes}
            />
          </div>
        </section>

        {showSecondarySidebar && (
          <SidebarDivider
            target="secondary"
            onResize={beginResize}
            label="Resize secondary sidebar"
          />
        )}

        {showSecondarySidebar && (
          <Sidebar
            views={secondaryViews}
            zone="secondarySidebar"
            width={secondarySidebarWidth}
            panelStates={panelStates}
            panelHeights={panelHeights}
            onPanelStateChange={(viewId, isOpen) =>
              setPanelStates((prev) => ({ ...prev, [viewId]: isOpen }))
            }
            onPanelResize={(viewId, height) =>
              setPanelHeights((prev) => ({ ...prev, [viewId]: height }))
            }
            onExecuteCommand={(commandId) => {
              void executeCommand(commandId);
            }}
            canExecuteCommand={canExecuteCommand}
          />
        )}
      </main>

      {visibleZones.has("panel") && panelTabs.length > 0 && (
        <div
          className="shell-divider-horizontal"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          onMouseDown={(event) => beginResizePanel(event.clientY)}
        />
      )}

      {visibleZones.has("panel") && panelTabs.length > 0 && (
        <section className="shell-panel" style={{ height: panelHeight }}>
          <div className="shell-panel-tabs">
            {panelTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`shell-panel-tab ${activePanelTab === tab.id ? "active" : ""}`}
                onClick={() => setActivePanelTab(tab.id)}
              >
                {tab.title}
              </button>
            ))}
          </div>
          <div className="shell-panel-content">
            {activePanelTab
              ? panelTabs.find((tab) => tab.id === activePanelTab)?.render()
              : panelTabs[0]?.render()}
          </div>
        </section>
      )}

      {visibleZones.has("statusBar") && (
        <StatusBar
          statusItemsLeft={statusItemsLeft}
          statusItemsRight={statusItemsRight}
          executeCommand={executeCommand}
          canExecuteCommand={canExecuteCommand}
        />
      )}

      <SettingsModalHost />
      <MessageDialogHost />
      <InputDialogHost />
      <QuickCommandHost filesRegistry={filesRegistry} fileMediator={fileMediator} />
    </div>
  );
}
