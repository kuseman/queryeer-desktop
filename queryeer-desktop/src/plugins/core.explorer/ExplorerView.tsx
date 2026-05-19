import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import type { ExplorerFolder, ExplorerTreeNode, ExplorerFolderNode, ExplorerFileNode } from "./types";
import { ExplorerStore } from "./store";
import { getCoreSettingsService } from "../core.settings/service";
import { buildTabTooltip, TabTooltip } from "../core.layout/TabTooltip";
import { TRACKED_FOLDERS_SETTING_ID, WORKSPACE_OPEN_FILES_ORDER_SETTING_ID } from "./plugin";
import { orderWorkspaceFiles, type WorkspaceOpenFilesOrder } from "./workspace-ordering";

const WORKSPACE_ROOT_ID = "workspace-root";
const WORKSPACE_SELECTED_PREFIX = "workspace-file:";

export type ExplorerFileItem = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: string;
};

export type ExplorerReadDirFn = (uri: string) => Promise<{ success: boolean; items: ExplorerFileItem[] }>;

type ExplorerViewProps = {
  context: PluginContext;
  filesRegistry: FilesRegistry;
  store: ExplorerStore;
  readDir?: ExplorerReadDirFn;
};

type HoveredWorkspaceRow = {
  fileId: string;
  rect: DOMRect;
};

function getFileName(uri: string): string {
  // Strip URI scheme prefix from non-file URIs (e.g. "untitled:Query1.sql" → "Query1.sql")
  if (uri.startsWith("untitled:")) {
    return uri.slice(9);
  }
  const normalized = uri.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? uri;
}

function resolveWorkspaceOrderSetting(): WorkspaceOpenFilesOrder {
  const value = getCoreSettingsService()?.getValue(WORKSPACE_OPEN_FILES_ORDER_SETTING_ID);
  if (value === "alphabetical" || value === "lastUsed") {
    return value;
  }
  return "tabOrder";
}

const JDBC_CONNECTIONS_SETTING_ID = "core.queryengine.jdbc.connections";

function resolveAccentColor(file: FileEntity): string | undefined {
  const settings = getCoreSettingsService();
  if (!settings) {
    return undefined;
  }

  // JDBC connection color takes priority when the file is bound to a JDBC engine
  if (file.engineBinding?.engineId === "jdbc" && file.engineBinding?.connectionId) {
    const raw = settings.getValue(JDBC_CONNECTIONS_SETTING_ID);
    if (Array.isArray(raw)) {
      const jdbcColor = (raw as { connectionId: string; color?: string }[]).find(
        (entry) => entry.connectionId === file.engineBinding!.connectionId
      )?.color;
      if (jdbcColor) {
        return jdbcColor;
      }
    }
  }

  // Fall back to mime-type color
  const configured = settings.getValue("core.files.mimeTypes");
  if (!Array.isArray(configured)) {
    return undefined;
  }
  const item = configured.find(
    (entry: unknown) =>
      entry &&
      typeof entry === "object" &&
      (entry as Record<string, unknown>).mimeType === file.mimeType
  ) as { color?: string } | undefined;
  if (item?.color && item.color.startsWith("#")) {
    return item.color;
  }
  return undefined;
}

function fileAccentStyle(file: FileEntity): React.CSSProperties | undefined {
  const color = resolveAccentColor(file);
  if (!color) {
    return undefined;
  }
  return {
    "--tab-accent-color": color
  } as React.CSSProperties;
}

export function ExplorerView({ context, filesRegistry, store, readDir }: ExplorerViewProps) {
  const [folders, setFolders] = useState<ExplorerFolder[]>(store.getFolders());
  const [openFiles, setOpenFiles] = useState<FileEntity[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(context.fileMediator.getActiveFileId());
  const [workspaceOrder, setWorkspaceOrder] = useState<WorkspaceOpenFilesOrder>(() =>
    resolveWorkspaceOrderSetting()
  );
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [hoveredWorkspaceRow, setHoveredWorkspaceRow] = useState<HoveredWorkspaceRow | null>(null);
  const [, setForceUpdate] = useState(0);
  const loadedRef = useRef<Set<string>>(new Set());
  const workspaceMenuRef = useRef<HTMLDivElement | null>(null);
  const mruCounterRef = useRef(0);
  const mruRankByFileIdRef = useRef(new Map<string, number>());

  const tooltipContributions = useMemo(() => {
    const all = context.tooltip.listTooltipSections?.() ?? [];
    return [...all].sort((a, b) => a.order - b.order);
  }, [context.tooltip]);

  const orderedWorkspaceFiles = useMemo(
    () => orderWorkspaceFiles(openFiles, workspaceOrder, mruRankByFileIdRef.current),
    [openFiles, workspaceOrder]
  );

  const hoveredTooltipProps = hoveredWorkspaceRow
    ? buildTabTooltip(
        openFiles.find((file) => file.fileId === hoveredWorkspaceRow.fileId),
        tooltipContributions
      )
    : { sections: [] };

  useEffect(() => {
    const unsubscribe = store.subscribe(() => {
      setFolders(store.getFolders());
      setForceUpdate((n) => n + 1);
    });
    return unsubscribe;
  }, [store]);

  useEffect(() => {
    const unsubscribe = filesRegistry.subscribe((files) => {
      setOpenFiles(files);
      for (const file of files) {
        store.markFileOpen(file.fileId, true);
      }
      const existing = new Set(files.map((f) => f.fileId));
      for (const key of [...mruRankByFileIdRef.current.keys()]) {
        if (!existing.has(key)) {
          mruRankByFileIdRef.current.delete(key);
        }
      }
    });
    return unsubscribe;
  }, [filesRegistry, store]);

  useEffect(() => {
    setWorkspaceOrder(resolveWorkspaceOrderSetting());
  }, []);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!workspaceMenuOpen) {
        return;
      }
      const target = event.target as Node;
      if (!workspaceMenuRef.current?.contains(target)) {
        setWorkspaceMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [workspaceMenuOpen]);

  useEffect(() => {
    const unsubscribe = context.fileMediator.onActiveFileChanged((fileId) => {
      setActiveFileId(fileId);
      if (!fileId) {
        return;
      }
      mruCounterRef.current += 1;
      mruRankByFileIdRef.current.set(fileId, mruCounterRef.current);
      if (workspaceOrder === "lastUsed") {
        setForceUpdate((n) => n + 1);
      }
    });
    return unsubscribe;
  }, [context.fileMediator, workspaceOrder]);

  const loadChildren = useCallback(
    async (folderId: string, folderUri: string) => {
      if (loadedRef.current.has(folderId)) {
        return;
      }
      if (!readDir) {
        return;
      }
      const result = await readDir(folderUri);
      if (!result.success) {
        return;
      }
      const children: ExplorerTreeNode[] = [];
      const treeNodes = store.getTreeNodes();
      const foldersNow = store.getFolders();
      let rootFolderId = folderId;
      let cursor = treeNodes.get(folderId);
      while (cursor && cursor.type === "folder" && cursor.parentId) {
        rootFolderId = cursor.parentId;
        cursor = treeNodes.get(cursor.parentId);
      }
      const rootFolder = foldersNow.find((folder) => folder.id === rootFolderId);
      let filterRegex: RegExp | null = null;
      if (rootFolder?.filterRegex) {
        try {
          filterRegex = new RegExp(rootFolder.filterRegex, "i");
        } catch {
          filterRegex = null;
        }
      }
      let idx = 0;
      for (const item of result.items) {
        if (!item.isDirectory && !item.isFile) {
          continue;
        }
        const parentUri = folderUri.replace(/\/$/, "");
        const itemUri = `${parentUri}/${item.name}`;
        const nodeId = `${folderId}-${idx}`;
        if (item.isDirectory) {
          children.push({
            type: "folder",
            id: nodeId,
            name: item.name,
            uri: itemUri,
            parentId: folderId,
            isExpanded: false,
            children: [],
            loaded: false
          } as ExplorerFolderNode);
        } else {
          if (filterRegex && !filterRegex.test(item.name)) {
            continue;
          }
          children.push({
            type: "file",
            id: nodeId,
            name: item.name,
            uri: itemUri,
            parentId: folderId,
            isOpen: false
          });
        }
        idx += 1;
      }
      children.sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      store.setChildren(folderId, children);
      loadedRef.current.add(folderId);
      store.markFolderLoaded(folderId);
    },
    [store, readDir]
  );

  const handleToggleFolder = useCallback(
    async (folderId: string) => {
      store.toggleFolder(folderId);
      store.setSelectedItemId(folderId);
      const state = store.getState();
      const node = state.treeNodes.get(folderId);
      if (node?.type === "folder" && node.isExpanded && !node.loaded) {
        await loadChildren(folderId, node.uri);
      }
    },
    [store, loadChildren]
  );

  const handleFileClick = useCallback(
    async (uri: string, isDoubleClick: boolean) => {
      const treeNodes = store.getTreeNodes();
      const fileNode = Array.from(treeNodes.values()).find(
        (n) => n.type === "file" && n.uri === uri
      ) as ExplorerFileNode | undefined;

      if (fileNode) {
        store.setSelectedItemId(fileNode.id);
      }

      const existingFile = openFiles.find((f) => f.uri === uri);
      if (existingFile) {
        store.setSelectedItemId(`${WORKSPACE_SELECTED_PREFIX}${existingFile.fileId}`);
        context.fileMediator.setActiveFileId(existingFile.fileId);
        setActiveFileId(existingFile.fileId);
        return;
      }
      if (isDoubleClick) {
        await context.fileMediator.openFile(uri, { openIntent: "edit" });
      } else {
        await context.fileMediator.openFile(uri, { openIntent: "view" });
        store.setPreviewFileId(uri);
      }
    },
    [context.fileMediator, openFiles, store]
  );

  const setWorkspaceOrderValue = useCallback(async (nextOrder: WorkspaceOpenFilesOrder) => {
    setWorkspaceOrder(nextOrder);
    setWorkspaceMenuOpen(false);
    const service = getCoreSettingsService();
    if (service) {
      await service.setValue(WORKSPACE_OPEN_FILES_ORDER_SETTING_ID, nextOrder);
    }
  }, []);

  return (
    <div className="explorer-view">
      <div className="explorer-tree">
        <div className="explorer-folder explorer-workspace-folder">
          <div
            className={`explorer-folder-header explorer-workspace-header ${store.getSelectedItemId() === WORKSPACE_ROOT_ID ? "is-selected" : ""}`}
            onClick={() => store.setSelectedItemId(WORKSPACE_ROOT_ID)}
          >
            <span className="explorer-chevron expanded">▶</span>
            <span className="explorer-folder-icon">🧩</span>
            <span className="explorer-folder-name">Workspace</span>
            <div className="explorer-workspace-menu" ref={workspaceMenuRef}>
              <button
                className="explorer-workspace-menu-button"
                type="button"
                aria-label="Workspace file order options"
                onClick={(event) => {
                  event.stopPropagation();
                  setWorkspaceMenuOpen((open) => !open);
                }}
              >
                ...
              </button>
              {workspaceMenuOpen && (
                <div className="explorer-workspace-menu-list" role="menu">
                  <button
                    type="button"
                    className={`explorer-workspace-menu-item ${workspaceOrder === "tabOrder" ? "is-selected" : ""}`}
                    onClick={() => {
                      void setWorkspaceOrderValue("tabOrder");
                    }}
                  >
                    Current tab order
                  </button>
                  <button
                    type="button"
                    className={`explorer-workspace-menu-item ${workspaceOrder === "alphabetical" ? "is-selected" : ""}`}
                    onClick={() => {
                      void setWorkspaceOrderValue("alphabetical");
                    }}
                  >
                    Alphabetical
                  </button>
                  <button
                    type="button"
                    className={`explorer-workspace-menu-item ${workspaceOrder === "lastUsed" ? "is-selected" : ""}`}
                    onClick={() => {
                      void setWorkspaceOrderValue("lastUsed");
                    }}
                  >
                    Most recently used
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="explorer-folder-content">
            {orderedWorkspaceFiles.map((file) => {
              const isActive = file.fileId === activeFileId;
              const selectedItemId = store.getSelectedItemId();
              const isSelected = selectedItemId === `${WORKSPACE_SELECTED_PREFIX}${file.fileId}`;
              const isDirty = file.dirtyVsDisk || file.dirtyVsBackend;
              return (
                <div
                  key={file.fileId}
                  className={`explorer-file explorer-workspace-file ${isActive ? "active" : ""} ${isSelected ? "is-selected" : ""} ${isDirty ? "dirty" : ""}`}
                  style={fileAccentStyle(file)}
                  onClick={() => {
                    store.setSelectedItemId(`${WORKSPACE_SELECTED_PREFIX}${file.fileId}`);
                    context.fileMediator.setActiveFileId(file.fileId);
                    setActiveFileId(file.fileId);
                  }}
                  onMouseEnter={(event) => {
                    setHoveredWorkspaceRow({
                      fileId: file.fileId,
                      rect: event.currentTarget.getBoundingClientRect()
                    });
                  }}
                  onMouseLeave={() => setHoveredWorkspaceRow(null)}
                >
                  <span className="explorer-file-icon">📄</span>
                  <span className="explorer-file-name">{getFileName(file.uri)}</span>
                </div>
              );
            })}
          </div>
        </div>
        {folders.map((folder) => (
          <FolderTreeItem
            key={folder.id}
            folder={folder}
            store={store}
            openFiles={openFiles}
            activeFileId={activeFileId}
            selectedItemId={store.getSelectedItemId()}
            onToggle={handleToggleFolder}
            onFileClick={handleFileClick}
            onLoadChildren={loadChildren}
            onRemoveFolder={(folderId) => {
              void (async () => {
                const folder = store.getFolders().find((item) => item.id === folderId);
                const result = await context.dialog.showMessage({
                  title: "Remove Folder",
                  message: `Are you sure you want to remove "${folder?.name ?? "this folder"}" from Explorer?`,
                  severity: "warning",
                  options: [
                    { label: "Remove", value: "remove" },
                    { label: "Cancel", value: "cancel" }
                  ]
                });
                if (result.action !== "remove") {
                  return;
                }
                store.removeFolder(folderId);
                if (store.getSelectedItemId() === folderId) {
                  store.setSelectedItemId(null);
                }
                const settings = getCoreSettingsService();
                if (settings) {
                  await settings.setValue(
                    TRACKED_FOLDERS_SETTING_ID,
                    store.getFolders().map((item) => ({
                      uri: item.uri,
                      name: item.name,
                      filterRegex: item.filterRegex
                    }))
                  );
                }
              })();
            }}
            canRemove
          />
        ))}
      </div>
      {hoveredWorkspaceRow && hoveredTooltipProps.sections.length > 0 && (
        <div
          className="shell-tab-tooltip explorer-workspace-tooltip"
          style={{
            left: hoveredWorkspaceRow.rect.left - 8,
            top: hoveredWorkspaceRow.rect.bottom + 4
          }}
        >
          <TabTooltip {...hoveredTooltipProps} />
        </div>
      )}
    </div>
  );
}

type FolderTreeItemProps = {
  folder: ExplorerFolder;
  store: ExplorerStore;
  openFiles: FileEntity[];
  activeFileId: string | null;
  selectedItemId: string | null;
  onToggle: (folderId: string) => void;
  onFileClick: (uri: string, isDoubleClick: boolean) => void;
  onLoadChildren: (folderId: string, folderUri: string) => Promise<void>;
  onRemoveFolder: (folderId: string) => void;
  canRemove?: boolean;
};

function FolderTreeItem({
  folder,
  store,
  openFiles,
  activeFileId,
  selectedItemId,
  onToggle,
  onFileClick,
  onLoadChildren,
  onRemoveFolder,
  canRemove = false
}: FolderTreeItemProps) {
  const treeNodes = store.getTreeNodes();
  const folderNode = treeNodes.get(folder.id);
  const isExpanded = folderNode?.type === "folder" && folderNode.isExpanded;
  const isLoaded = folderNode?.type === "folder" && folderNode.loaded;

  useEffect(() => {
    if (isExpanded && !isLoaded) {
      void onLoadChildren(folder.id, folder.uri);
    }
  }, [isExpanded, isLoaded, folder.id, folder.uri, onLoadChildren]);

  const childNodes =
    folderNode?.type === "folder"
      ? folderNode.children.map((id) => treeNodes.get(id)).filter(Boolean)
      : [];

  return (
    <div className="explorer-folder">
      <div
        className={`explorer-folder-header ${selectedItemId === folder.id ? "is-selected" : ""}`}
        onClick={() => {
          void onToggle(folder.id);
        }}
      >
        <span className={`explorer-chevron ${isExpanded ? "expanded" : ""}`}>▶</span>
        <span className="explorer-folder-icon">📁</span>
        <span className="explorer-folder-name">{folder.name}</span>
        {canRemove && (
          <button
            type="button"
            className="explorer-remove"
            aria-label={`Remove ${folder.name}`}
            onClick={(event) => {
              event.stopPropagation();
              onRemoveFolder(folder.id);
            }}
          >
            ×
          </button>
        )}
      </div>
      {isExpanded && (
        <div className="explorer-folder-content">
          {childNodes.map((node) => {
            if (!node) return null;
            if (node.type === "folder") {
              return (
                <FolderTreeItem
                  key={node.id}
                  folder={{ id: node.id, uri: node.uri, name: node.name, filterRegex: folder.filterRegex }}
                  store={store}
                  openFiles={openFiles}
                  activeFileId={activeFileId}
                  selectedItemId={null}
                  onToggle={onToggle}
                  onFileClick={onFileClick}
                  onLoadChildren={onLoadChildren}
                  onRemoveFolder={onRemoveFolder}
                  canRemove={false}
                />
              );
            }
            const fileNode = node;
            const fileNodeId = fileNode.id;
            const openFile = openFiles.find((f) => f.uri === fileNode.uri);
            const isActive = openFile?.fileId === activeFileId;
            const isSelected = fileNodeId === selectedItemId;
            const isDirty = openFile?.dirtyVsDisk || openFile?.dirtyVsBackend;
            return (
              <div
                key={fileNode.id}
                className={`explorer-file ${isActive ? "active" : ""} ${isSelected ? "is-selected" : ""} ${isDirty ? "dirty" : ""}`}
                onClick={() => {
                  void onFileClick(fileNode.uri, false);
                }}
                onDoubleClick={() => {
                  void onFileClick(fileNode.uri, true);
                }}
              >
                <span className="explorer-file-icon">📄</span>
                <span className="explorer-file-name">{fileNode.name}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
