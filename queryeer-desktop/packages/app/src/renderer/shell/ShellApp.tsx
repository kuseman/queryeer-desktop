import { Fragment, useEffect, useMemo, useCallback, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { ExtensionSnapshot } from "../../core/plugin-runtime/ExtensionRegistry";
import type {
  LayoutZone,
  LayoutEditorContribution,
  LayoutToolbarContext
} from "@queryeer/api/extensions/LayoutExtension";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { filesAreStructurallyIdentical } from "./file-entity-utils";
import type { FileMediator } from "@queryeer/api/files/FileMediator";
import type { FilesRegistry } from "@queryeer/api/files/FilesRegistry";
import type { CommandExecutionResult } from "@queryeer/api/plugin/Plugin";
import "@queryeer/api/shell/Api";
import type { ContextChain } from "../../plugins/core.commands/context-chain";
import { ContextPriority } from "../../plugins/core.commands/context-priority";
import { CoreMenuBar } from "../../plugins/core.menu/MenuBar";
import type { RendererWorkspaceService } from "../workspace/workspace-service";
import { Toolbar, StatusBar, Sidebar, SidebarDivider, EditorTabs, EditorPane, PluginErrorBoundary } from "../../plugins/core.layout";
import { SettingsModalHost } from "../../plugins/core.settings/SettingsModalHost";
import { InputDialogHost } from "../../plugins/core.dialog/InputDialogHost";
import { MessageDialogHost } from "../../plugins/core.dialog/MessageDialogHost";
import { ValuePreviewHost } from "../../plugins/core.dialog/ValuePreviewHost";
import { QuickCommandHost } from "../../plugins/core.quickcommand/QuickCommandHost";
import { AboutDialogHost } from "../../plugins/core.about/AboutDialogHost.js";
import { NotificationHost } from "../../plugins/core.notification/NotificationHost";
import { filterMenuItemsByWhen } from "../../plugins/core.menu/menu-item-filter";
import { confirmCloseDirtyFile } from "./close-file-guard";
import { planCloseFileInGroup } from "./close-file-plan";
import { requestMessageDialog } from "../../plugins/core.dialog/message-dialog-service";
import { filterSidebarViews } from "./sidebar-view-filter";
import { filterToolbarActions } from "./toolbar-action-filter";
import { inflateDottedKeys } from "./context-value-flatten";
import { subscribeOpenPanelRequests } from "./layout-panel-events";
import { subscribeFocusSidebarViewRequests } from "./layout-sidebar-events";
import { subscribeToggleZoneRequests } from "./layout-zone-events";
import {
  subscribeCloseActiveEditorRequests,
  subscribeOpenEditorToSideRequests,
  subscribeSplitActiveEditorRightRequests,
  subscribeToggleMaximizeActiveEditorGroupRequests
} from "./layout-editor-events";
import { getOutlineRegistry } from "../../core/plugin-runtime/ExtensionRegistry";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../../plugins/core.settings/service";
import { getKeybindingLabel } from "../../plugins/core.commands/keybinding-label-accessor";
import { subscribeKeybindingsRuntime } from "../../plugins/core.commands/keybindings-runtime-accessor";
import { hasActiveQueryPlanDialect } from "../../plugins/core.queryengine/query-plan/supported-dialects";
import {
  createPersistedEditorLayout,
  focusEditorGroup,
  getActiveEditorGroup,
  getActiveWorkbenchFileId,
  listWorkbenchFileIds,
  moveFileToSide,
  openFileInActiveGroup,
  openFileToSide,
  resizeAdjacentEditorGroups,
  restoreEditorWorkbenchStateFromSnapshot,
  selectFileInGroup,
  splitActiveGroupRight,
  syncWorkbenchWithFiles,
  toggleMaximizedEditorGroup,
  type EditorWorkbenchState
} from "./editor-workbench-state";
import { createEditorInstanceId } from "./editor-instance-id";
import { applyEditorGroupSizePreview, getEditorGroupElements } from "./editor-split-resize";
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
  contextChain: ContextChain;
};

export function ShellApp({
  extensions,
  filesRegistry,
  fileMediator,
  workspaceService,
  executeCommand,
  canExecuteCommand,
  onCommandContextChanged,
  contextChain
}: ShellAppProps): JSX.Element {
  const [, setKeybindingsVersion] = useState(0);
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
  const [editorWorkbench, setEditorWorkbench] = useState<EditorWorkbenchState>(() => {
    const initialFiles = filesRegistry.listFiles();
    return restoreEditorWorkbenchStateFromSnapshot(
      initialFiles.map((file) => ({ fileId: file.fileId, uri: file.uri })),
      workspaceService.restoredLayout(),
      workspaceService.restoredActiveFileId() ?? initialFiles[0]?.fileId ?? null
    );
  });
  const activeFileId = getActiveWorkbenchFileId(editorWorkbench);
  const activeGroup = getActiveEditorGroup(editorWorkbench);
  const activeFile = activeFileId
    ? files.find((file) => file.fileId === activeFileId) ?? undefined
    : undefined;
  const filesRef = useRef<FileEntity[]>(files);
  const editorWorkbenchRef = useRef<EditorWorkbenchState>(editorWorkbench);
  const activeFileIdRef = useRef<string | null>(activeFileId);
  const [, setSettingsVersion] = useState(0);
  const layoutRef = useRef<HTMLElement | null>(null);
  const shellMainRef = useRef<HTMLDivElement | null>(null);
  const tabsByGroupRef = useRef(new Map<string, HTMLDivElement | null>());
  const canSplitFileRef = useRef<(fileId: string) => boolean>(() => false);
  const visibleZonesRef = useRef(visibleZones);
  const activePanelTabRef = useRef(activePanelTab);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    activeFileIdRef.current = activeFileId;
  }, [activeFileId]);

  useEffect(() => {
    editorWorkbenchRef.current = editorWorkbench;
  }, [editorWorkbench]);

  useEffect(() => {
    visibleZonesRef.current = visibleZones;
  }, [visibleZones]);

  useEffect(() => {
    activePanelTabRef.current = activePanelTab;
  }, [activePanelTab]);

  useEffect(() => {
    const unregister = contextChain.register({
      id: "core.layout.editorGroup",
      priority: ContextPriority.EDITOR_GROUP,
      context: {}
    });
    return unregister;
  }, [contextChain]);

  useEffect(() => {
    workspaceService.setActiveFileSnapshotProvider(() => activeFileIdRef.current);
  }, [workspaceService]);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    onCoreSettingsServiceInitialized((service) => {
      unsub = service.subscribe(() => {
        setSettingsVersion((version) => version + 1);
      });
    });
    return () => unsub?.();
  }, []);

  const toggleZone = useCallback((zone: LayoutZone) => {
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
  }, []);

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
      hasOpenFiles: listWorkbenchFileIds(editorWorkbench).length > 0,
      activeFileId,
      hasActiveFile: activeFileForViewContext != null,
      activeFile: activeFileForViewContext
        ? {
            fileId: activeFileForViewContext.fileId,
            uri: activeFileForViewContext.uri,
            editorId: activeFileForViewContext.editorId,
            mimeType: activeFileForViewContext.mimeType,
            metadata: inflateDottedKeys(activeFileForViewContext.metadata ?? {}),
            engineBinding: activeFileForViewContext.engineBinding,
          }
        : null,
      activeFileEditorId: activeFileForViewContext?.editorId,
      hasActiveQueryExecutableFile,
      hasActiveQueryPlanDialect: hasActiveQueryPlanDialect(activeFileForViewContext),
      outlineSupported
    };
  }, [activeFileId, editorWorkbench, files, filesRegistry]);

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

  const toolbarContext = useMemo<LayoutToolbarContext>(() => ({
    activeFile,
    activeEditorGroupId: activeGroup.id,
    editorGroupCount: editorWorkbench.groups.length,
    hasMultipleEditorGroups: editorWorkbench.groups.length > 1
  }), [activeFile, activeGroup.id, editorWorkbench.groups.length]);

  useEffect(() => {
    const activeEditorForContext = activeFile?.editorId ? editorsById.get(activeFile.editorId) : undefined;
    contextChain.update("core.layout.editorGroup", {
      activeEditorGroupId: activeGroup.id,
      editorGroupCount: editorWorkbench.groups.length,
      hasMultipleEditorGroups: editorWorkbench.groups.length > 1,
      activeEditorCanSplit: activeEditorForContext?.canSplit === true
    });
    contextChain.activate("core.layout.editorGroup");
  }, [activeFile, activeGroup.id, contextChain, editorWorkbench.groups, editorsById]);

  const commandTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const command of extensions.commands) {
      map.set(command.id, command.title);
    }
    return map;
  }, [extensions.commands]);

  const getCommandTitle = useCallback(
    (commandId: string) => commandTitleById.get(commandId),
    [commandTitleById]
  );

  const getCommandAccelerator = useCallback(
    (commandId: string) => getKeybindingLabel(commandId),
    []
  );

  useEffect(() => {
    return subscribeKeybindingsRuntime(() => {
      setKeybindingsVersion((version) => version + 1);
    });
  }, []);

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

  useEffect(() => {
    return subscribeToggleZoneRequests((zone) => {
      toggleZone(zone);
    });
  }, [toggleZone]);

  useEffect(() => {
    return subscribeSplitActiveEditorRightRequests(() => {
      setEditorWorkbench((previous) => {
        const fileId = getActiveWorkbenchFileId(previous);
        if (!fileId || !canSplitFileRef.current(fileId)) {
          return previous;
        }
        return splitActiveGroupRight(previous);
      });
    });
  }, []);

  useEffect(() => {
    return subscribeOpenEditorToSideRequests((request) => {
      setEditorWorkbench((previous) => openFileToSide(previous, request.fileId, {
        removeFromOtherGroups: request.removeFromOtherGroups
      }));
    });
  }, []);

  useEffect(() => {
    return subscribeToggleMaximizeActiveEditorGroupRequests(() => {
      setEditorWorkbench((previous) => toggleMaximizedEditorGroup(previous, previous.activeGroupId));
    });
  }, []);

  useEffect(() => {
    return subscribeFocusSidebarViewRequests((request) => {
      const requestedZone = request.zone
        ?? (request.viewId
          ? extensions.layout.views.find((view) => view.id === request.viewId)?.defaultZone
          : undefined)
        ?? "primarySidebar";

      setVisibleZones((previous) => {
        const next = new Set(previous);
        next.add(requestedZone);
        next.add("mainArea");
        next.add("statusBar");
        return next;
      });

      if (request.viewId) {
        setPanelStates((previous) => ({
          ...previous,
          [request.viewId!]: true
        }));
      }
    });
  }, [extensions.layout.views]);

  const handleTabContextMenuOpen = useCallback(
    (file: FileEntity | null) => {
      fileMediator.setContextFileId(file?.fileId ?? null);
    },
    [fileMediator]
  );

  const canSplitFile = useCallback(
    (fileId: string): boolean => {
      const file = files.find((candidate) => candidate.fileId === fileId);
      if (!file?.editorId) {
        return false;
      }
      return editorsById.get(file.editorId)?.canSplit === true;
    },
    [editorsById, files]
  );

  useEffect(() => {
    canSplitFileRef.current = canSplitFile;
  }, [canSplitFile]);

  const closeFile = useCallback((fileId: string, groupId: string = editorWorkbenchRef.current.activeGroupId) => {
    const file = filesRegistry.getFile(fileId);
    const plan = planCloseFileInGroup(editorWorkbenchRef.current, groupId, fileId, file);
    if (!file) {
      setEditorWorkbench(plan.nextWorkbench);
      return;
    }
    void (async () => {
      if (plan.shouldConfirm && !await confirmCloseDirtyFile(file, requestMessageDialog)) {
        return;
      }
      setEditorWorkbench(plan.nextWorkbench);
      if (plan.shouldCloseGlobally) {
        await fileMediator.closeFile(fileId, { discardDirty: true });
      }
    })();
  }, [fileMediator, filesRegistry]);

  useEffect(() => {
    return subscribeCloseActiveEditorRequests(() => {
      const fileId = getActiveWorkbenchFileId(editorWorkbenchRef.current);
      if (!fileId) {
        return;
      }
      closeFile(fileId, editorWorkbenchRef.current.activeGroupId);
    });
  }, [closeFile]);

  const closeFilesInGroup = (groupId: string, shouldClose: (fileId: string) => boolean) => {
    void (async () => {
      let nextWorkbench = editorWorkbenchRef.current;
      const group = nextWorkbench.groups.find((candidate) => candidate.id === groupId);
      if (!group) {
        return;
      }
      const fileIdsToEvaluate = group.fileIds.filter(shouldClose);
      const fileIdsToCloseGlobally: string[] = [];

      for (const fileId of fileIdsToEvaluate) {
        const file = filesRegistry.getFile(fileId);
        const plan = planCloseFileInGroup(nextWorkbench, groupId, fileId, file);
        if (file && plan.shouldConfirm) {
          const confirmed = await confirmCloseDirtyFile(file, requestMessageDialog);
          if (!confirmed) {
            return;
          }
        }
        if (plan.shouldCloseGlobally) {
          fileIdsToCloseGlobally.push(fileId);
        }
        nextWorkbench = plan.nextWorkbench;
      }

      setEditorWorkbench(nextWorkbench);
      for (const fileId of fileIdsToCloseGlobally) {
        await fileMediator.closeFile(fileId, { discardDirty: true });
      }
    })();
  };

  const handleTabContextMenuAction = (actionId: string, file: FileEntity, groupId: string) => {
    if (actionId === "core.layout.tab.close") {
      closeFile(file.fileId, groupId);
      return;
    }
    if (actionId === "core.layout.tab.closeOthers") {
      closeFilesInGroup(groupId, (fileId) => fileId !== file.fileId);
      return;
    }
    if (actionId === "core.layout.tab.closeAll") {
      closeFilesInGroup(groupId, () => true);
      return;
    }
    if (actionId === "core.layout.tab.splitRight") {
      if (canSplitFile(file.fileId)) {
        setEditorWorkbench((previous) => splitActiveGroupRight(selectFileInGroup(previous, groupId, file.fileId)));
      }
      return;
    }
    if (actionId === "core.layout.tab.moveLeft" || actionId === "core.layout.tab.moveRight") {
      const openNewFilesLast = getCoreSettingsService()?.getValue(OPEN_NEW_FILES_LAST_SETTING_ID) !== false;
      setEditorWorkbench((previous) => moveFileToSide(
        previous,
        groupId,
        file.fileId,
        actionId === "core.layout.tab.moveLeft" ? "left" : "right",
        { openNewFilesLast }
      ));
      return;
    }
    void executeCommand(actionId);
  };

  const selectFile = (fileId: string, groupId: string = editorWorkbenchRef.current.activeGroupId) => {
    setEditorWorkbench((previous) => selectFileInGroup(previous, groupId, fileId));
  };

  const focusGroup = (groupId: string) => {
    setEditorWorkbench((previous) => focusEditorGroup(previous, groupId));
  };

  const toggleMaximizeGroup = (groupId: string) => {
    setEditorWorkbench((previous) => toggleMaximizedEditorGroup(previous, groupId));
  };

  useEffect(() => {
    workspaceService.setActiveFileId(activeFileId);
    fileMediator.setActiveFileId(activeFileId);
  }, [activeFileId, fileMediator, workspaceService]);

  useEffect(() => {
    return fileMediator.onActiveFileChanged((fileId) => {
      if (!fileId) {
        return;
      }
      if (fileId === activeFileIdRef.current) {
        return;
      }
      setEditorWorkbench((previous) => {
        const containingGroup = previous.groups.find((group) => group.fileIds.includes(fileId));
        if (containingGroup) {
          return selectFileInGroup(previous, containingGroup.id, fileId);
        }
        return openFileInActiveGroup(previous, fileId);
      });
    });
  }, [fileMediator]);

  useEffect(() => {
    if (!activeFileId) return;
    const activeTabs = tabsByGroupRef.current.get(activeGroup.id);
    if (!activeTabs) return;
    const tab = activeTabs.querySelector(`[data-file-id="${CSS.escape(activeFileId)}"]`);
    if (tab) {
      tab.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }
  }, [activeFileId, activeGroup.id]);

  useEffect(() => {
    const uriByFileId = new Map(files.map((file) => [file.fileId, file.uri]));
    const persistedMaximizedGroupId = editorWorkbench.groups.length > 1
      ? editorWorkbench.maximizedGroupId ?? undefined
      : undefined;
    workspaceService.setLayout({
      visibleZones: [...visibleZones],
      sidebarWidths: {
        primary: primarySidebarWidth,
        secondary: secondarySidebarWidth
      },
      sidebarPanelStates: panelStates,
      sidebarPanelHeights: panelHeights,
      panelHeight,
      editorGroups: editorWorkbench.groups.map((group) => ({
        id: group.id,
        fileUris: group.fileIds
          .map((fileId) => uriByFileId.get(fileId))
          .filter((uri): uri is string => Boolean(uri)),
        activeFileUri: group.activeFileId ? uriByFileId.get(group.activeFileId) : undefined
      })),
      activeEditorGroupId: activeGroup.id,
      maximizedEditorGroupId: persistedMaximizedGroupId,
      editorLayout: createPersistedEditorLayout(editorWorkbench)
    });
  }, [activeGroup.id, editorWorkbench, files, visibleZones, primarySidebarWidth, secondarySidebarWidth, panelStates, panelHeights, panelHeight, workspaceService]);

  useEffect(() => {
    return filesRegistry.subscribe((next) => {
      if (filesAreStructurallyIdentical(filesRef.current, next)) {
        return;
      }
      filesRef.current = next;
      setFiles(next);
      setEditorWorkbench((previous) => {
        const settings = getCoreSettingsService();
        const openNewFilesLast = settings?.getValue(OPEN_NEW_FILES_LAST_SETTING_ID) !== false;
        const resolution = syncWorkbenchWithFiles(
          previous,
          next.map((file) => ({ fileId: file.fileId, uri: file.uri })),
          { openNewFilesLast }
        );
        const uriByFileId = new Map(next.map((file) => [file.fileId, file.uri]));
        workspaceService.setOpenFileOrder(
          listWorkbenchFileIds(resolution.state)
            .map((fileId) => uriByFileId.get(fileId))
            .filter((uri): uri is string => Boolean(uri))
        );
        return resolution.state;
      });
    });
  }, [filesRegistry, workspaceService]);

  const beginResize = (target: "primary" | "secondary") => {
    const onMouseMove = (event: MouseEvent) => {
      const layout = layoutRef.current;
      if (!layout) {
        return;
      }

      const rect = layout.getBoundingClientRect();
      if (target === "primary") {
        const nextWidth = event.clientX - rect.left;
        setPrimarySidebarWidth(nextWidth);
      } else {
        const nextWidth = rect.right - event.clientX;
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

  const beginResizeEditorSplit = (dividerIndex: number, startX: number) => {
    const main = shellMainRef.current;
    if (!main) {
      return;
    }
    const rect = main.getBoundingClientRect();
    const totalWidth = Math.max(1, rect.width);
    const startWorkbench = editorWorkbenchRef.current;
    const minSize = 160 / totalWidth;
    const groupNodes = getEditorGroupElements(main);
    let nextWorkbench = startWorkbench;
    let moved = false;

    const onMouseMove = (event: MouseEvent) => {
      const delta = (event.clientX - startX) / totalWidth;
      nextWorkbench = resizeAdjacentEditorGroups(startWorkbench, dividerIndex, delta, minSize);
      moved = true;
      applyEditorGroupSizePreview(groupNodes, nextWorkbench.sizes);
    };

    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("is-resizing-editor-split");
      if (moved) {
        setEditorWorkbench(nextWorkbench);
      }
    };

    document.body.classList.add("is-resizing-editor-split");
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const focusEditorGroupFromPointer = (event: ReactMouseEvent<HTMLDivElement>): void => {
    focusGroup(event.currentTarget.dataset.editorGroupId ?? "");
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, select, button, [contenteditable='true'], [role='button']")) {
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
  };

  const showPrimarySidebar = visibleZones.has("primarySidebar");
  const showSecondarySidebar = visibleZones.has("secondarySidebar") && secondaryViews.length > 0;
  const maximizedGroupId = editorWorkbench.groups.length > 1 ? editorWorkbench.maximizedGroupId ?? null : null;
  const isEditorGroupMaximized = maximizedGroupId != null;
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
        executeCommand={executeCommand}
        canExecuteCommand={canExecuteCommand}
        getCommandAccelerator={getCommandAccelerator}
        getMimeIcon={filesRegistry.mimeIcons.getMimeIcon}
      />
      {visibleZones.has("toolBar") && (
        <Toolbar
          toolbarActions={toolbarActions}
          toolbarContext={toolbarContext}
          visibleZones={visibleZones}
          canExecuteCommand={canExecuteCommand}
          executeCommand={executeCommand}
          getCommandTitle={getCommandTitle}
          getCommandAccelerator={getCommandAccelerator}
          onCommandContextChanged={onCommandContextChanged}
        />
      )}

      <main className="shell-layout" ref={layoutRef} style={{ gridTemplateColumns: shellGridTemplateColumns }}>
        {showPrimarySidebar && (
          <Sidebar
            views={primaryViews}
            zone="primarySidebar"
            width={primarySidebarWidth}
            viewContext={toolbarContext}
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
          <div ref={shellMainRef} className={`shell-main ${editorWorkbench.groups.length > 1 ? "is-split" : ""} ${isEditorGroupMaximized ? "is-editor-group-maximized" : ""}`.trim()}>
            {editorWorkbench.groups.map((group, index) => {
              const groupFiles = group.fileIds
                .map((id) => files.find((file) => file.fileId === id))
                .filter((file): file is FileEntity => Boolean(file));
              const groupActiveFile = group.activeFileId
                ? files.find((file) => file.fileId === group.activeFileId) ?? null
                : null;
              const groupActiveEditor = groupActiveFile?.editorId
                ? editorsById.get(groupActiveFile.editorId) ?? null
                : null;
              const isActiveGroup = group.id === activeGroup.id;
              const isGroupMaximized = maximizedGroupId === group.id;
              const isGroupHiddenByMaximize = isEditorGroupMaximized && !isGroupMaximized;
              const editorInstanceContext = {
                editorInstanceId: createEditorInstanceId(
                  group.id,
                  groupActiveEditor?.id
                ),
                editorGroupId: group.id,
                editorGroupIndex: index,
                editorGroupCount: editorWorkbench.groups.length,
                isActiveEditorGroup: isActiveGroup
              };
              return (
                <Fragment key={group.id}>
                  {index > 0 && (
                    <div
                      key={`${group.id}-divider`}
                      className={`shell-editor-split-divider ${isEditorGroupMaximized ? "is-hidden-while-maximized" : ""}`.trim()}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label="Resize editor split"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        beginResizeEditorSplit(index - 1, event.clientX);
                      }}
                    />
                  )}
                  <div
                    key={group.id}
                    className={`shell-editor-group ${isActiveGroup ? "is-active" : ""} ${isGroupMaximized ? "is-maximized" : ""} ${isGroupHiddenByMaximize ? "is-hidden-while-maximized" : ""}`.trim()}
                    data-context="editor"
                    data-editor-group-id={group.id}
                    aria-hidden={isGroupHiddenByMaximize ? true : undefined}
                    tabIndex={-1}
                    style={{ flexGrow: isGroupHiddenByMaximize ? 0 : isGroupMaximized ? 1 : editorWorkbench.sizes[index] ?? 1 }}
                    onMouseDownCapture={focusEditorGroupFromPointer}
                    onFocusCapture={() => focusGroup(group.id)}
                  >
                    <EditorTabs
                      openFiles={groupFiles}
                      activeFileId={group.activeFileId}
                      editorGroupId={group.id}
                      editorGroupIndex={index}
                      editorGroupCount={editorWorkbench.groups.length}
                      editorsById={editorsById}
                      tabsRef={(node) => {
                        if (node) {
                          tabsByGroupRef.current.set(group.id, node);
                        } else {
                          tabsByGroupRef.current.delete(group.id);
                        }
                      }}
                      onSelectFile={(fileId) => selectFile(fileId, group.id)}
                      onCloseFile={(fileId) => closeFile(fileId, group.id)}
                      tooltipContributions={tooltipContributions}
                      tabContextMenus={tabContextMenus}
                      tabHeaderStyleContributions={tabHeaderStyleContributions}
                      tabTitleContributions={tabTitleContributions}
                      hasMimeCapability={(mimeType, capability) =>
                        filesRegistry.capabilities.hasCapability(mimeType, capability)
                      }
                      getMimeIcon={filesRegistry.mimeIcons.getMimeIcon}
                      onTabContextMenuAction={(actionId, file) => handleTabContextMenuAction(actionId, file, group.id)}
                      onTabContextMenuOpen={(file) => {
                        focusGroup(group.id);
                        handleTabContextMenuOpen(file);
                      }}
                      canMaximizeGroup={editorWorkbench.groups.length > 1}
                      isGroupMaximized={isGroupMaximized}
                      onToggleMaximizeGroup={() => toggleMaximizeGroup(group.id)}
                    />

                    <EditorPane
                      activeFile={groupActiveFile}
                      activeEditor={groupActiveEditor}
                      editorInstanceContext={editorInstanceContext}
                      welcomes={welcomes}
                    />
                  </div>
                </Fragment>
              );
            })}
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
            viewContext={toolbarContext}
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
              ? (
                <PluginErrorBoundary pluginId={activePanelTab}>
                  {panelTabs.find((tab) => tab.id === activePanelTab)?.render()}
                </PluginErrorBoundary>
              ) : (
                <PluginErrorBoundary pluginId={panelTabs[0]?.id ?? "panel"}>
                  {panelTabs[0]?.render()}
                </PluginErrorBoundary>
              )}
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
      <ValuePreviewHost />
      <QuickCommandHost filesRegistry={filesRegistry} fileMediator={fileMediator} />
      <AboutDialogHost />
      <NotificationHost />
    </div>
  );
}
