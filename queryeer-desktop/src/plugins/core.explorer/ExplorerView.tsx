import { useState, useEffect, useCallback, useRef } from "react";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import type { ExplorerFolder, ExplorerTreeNode, ExplorerFolderNode, ExplorerFileNode } from "./types";
import { ExplorerStore } from "./store";

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

export function ExplorerView({ context, filesRegistry, store, readDir }: ExplorerViewProps) {
  const [folders, setFolders] = useState<ExplorerFolder[]>(store.getFolders());
  const [openFiles, setOpenFiles] = useState<FileEntity[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(
    context.fileMediator.getActiveFileId()
  );
  const [, setForceUpdate] = useState(0);
  const loadedRef = useRef<Set<string>>(new Set());

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
    });
    return unsubscribe;
  }, [filesRegistry, store]);

  useEffect(() => {
    const currentActive = context.fileMediator.getActiveFileId();
    setActiveFileId(currentActive);
  }, [context.fileMediator]);

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
          children.push({
            type: "file",
            id: nodeId,
            name: item.name,
            uri: itemUri,
            parentId: folderId,
            isOpen: false
          });
        }
        idx++;
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
      // Find the file node ID for this URI
      const treeNodes = store.getTreeNodes();
      const fileNode = Array.from(treeNodes.values()).find(
        (n) => n.type === "file" && n.uri === uri
      ) as ExplorerFileNode | undefined;
      
      if (fileNode) {
        store.setSelectedItemId(fileNode.id);
      }

      const existingFile = openFiles.find((f) => f.uri === uri);
      if (existingFile) {
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

  if (folders.length === 0) {
    return (
      <div className="explorer-empty">
        <p>No folders added</p>
      </div>
    );
  }

  return (
    <div className="explorer-view">
      <div className="explorer-tree">
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
          />
        ))}
      </div>
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
};

function FolderTreeItem({
  folder,
  store,
  openFiles,
  activeFileId,
  selectedItemId,
  onToggle,
  onFileClick,
  onLoadChildren
}: FolderTreeItemProps) {
  const treeNodes = store.getTreeNodes();
  const folderNode = treeNodes.get(folder.id);
  const isExpanded = folderNode?.type === "folder" && folderNode.isExpanded;
  const isLoaded = folderNode?.type === "folder" && folderNode.loaded;

  useEffect(() => {
    if (isExpanded && !isLoaded) {
      onLoadChildren(folder.id, folder.uri);
    }
  }, [isExpanded, isLoaded, folder.id, folder.uri, onLoadChildren]);

  const childNodes = folderNode?.type === "folder"
    ? folderNode.children.map((id) => treeNodes.get(id)).filter(Boolean)
    : [];

  return (
    <div className="explorer-folder">
      <div
        className={`explorer-folder-header ${selectedItemId === folder.id ? "is-selected" : ""}`}
        onClick={() => onToggle(folder.id)}
      >
        <span className={`explorer-chevron ${isExpanded ? "expanded" : ""}`}>
          ▶
        </span>
        <span className="explorer-folder-icon">📁</span>
        <span className="explorer-folder-name">{folder.name}</span>
      </div>
      {isExpanded && (
        <div className="explorer-folder-content">
          {childNodes.map((node) => {
            if (!node) return null;
            if (node.type === "folder") {
              return (
                <FolderTreeItem
                  key={node.id}
                  folder={{ id: node.id, uri: node.uri, name: node.name }}
                  store={store}
                  openFiles={openFiles}
                  activeFileId={activeFileId}
                  selectedItemId={null}
                  onToggle={onToggle}
                  onFileClick={onFileClick}
                  onLoadChildren={onLoadChildren}
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
                onClick={() => onFileClick(fileNode.uri, false)}
                onDoubleClick={() => onFileClick(fileNode.uri, true)}
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