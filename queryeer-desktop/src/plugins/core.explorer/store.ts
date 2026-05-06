import type {
  ExplorerFolder,
  ExplorerFileNode,
  ExplorerFolderNode,
  ExplorerTreeNode
} from "./types";

type ExplorerStoreState = {
  folders: ExplorerFolder[];
  treeNodes: Map<string, ExplorerTreeNode>;
  expandedFolders: Set<string>;
  previewFileId: string | null;
  selectedItemId: string | null;
};

export class ExplorerStore {
  private state: ExplorerStoreState;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.state = {
      folders: [],
      treeNodes: new Map(),
      expandedFolders: new Set(),
      previewFileId: null,
      selectedItemId: null
    };
  }

  public getState(): ExplorerStoreState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public addFolder(uri: string, name: string, filterRegex: string): void {
    const folderId = `folder-${Date.now().toString(36)}-${this.state.folders.length}`;
    const folder: ExplorerFolder = {
      id: folderId,
      uri,
      name,
      filterRegex
    };

    const rootNode: ExplorerFolderNode = {
      type: "folder",
      id: folderId,
      name,
      uri,
      parentId: null,
      isExpanded: false,
      children: [],
      loaded: false
    };

    this.state = {
      ...this.state,
      folders: [...this.state.folders, folder],
      treeNodes: new Map([...this.state.treeNodes, [folderId, rootNode]])
    };
    this.emit();
  }

  public replaceFolders(folders: Array<{ uri: string; name: string; filterRegex: string }>): void {
    const nextFolders: ExplorerFolder[] = [];
    const treeNodes = new Map<string, ExplorerTreeNode>();
    const expandedFolders = new Set<string>();
    folders.forEach((folder, index) => {
      const folderId = `folder-restored-${index}`;
      nextFolders.push({
        id: folderId,
        uri: folder.uri,
        name: folder.name,
        filterRegex: folder.filterRegex
      });
      treeNodes.set(folderId, {
        type: "folder",
        id: folderId,
        name: folder.name,
        uri: folder.uri,
        parentId: null,
        isExpanded: false,
        children: [],
        loaded: false
      });
    });
    this.state = {
      ...this.state,
      folders: nextFolders,
      treeNodes,
      expandedFolders,
      selectedItemId: null
    };
    this.emit();
  }

  public removeFolder(folderId: string): void {
    const newFolders = this.state.folders.filter((f) => f.id !== folderId);
    const newTreeNodes = new Map(this.state.treeNodes);
    this.removeFolderAndChildren(folderId, newTreeNodes);

    const newExpandedFolders = new Set(this.state.expandedFolders);
    newExpandedFolders.delete(folderId);

    this.state = {
      ...this.state,
      folders: newFolders,
      treeNodes: newTreeNodes,
      expandedFolders: newExpandedFolders
    };
    this.emit();
  }

  private removeFolderAndChildren(nodeId: string, treeNodes: Map<string, ExplorerTreeNode>): void {
    const node = treeNodes.get(nodeId);
    if (!node) return;

    if (node.type === "folder") {
      for (const childId of node.children) {
        this.removeFolderAndChildren(childId, treeNodes);
      }
    }
    treeNodes.delete(nodeId);
  }

  public expandFolder(folderId: string): void {
    if (!this.state.expandedFolders.has(folderId)) {
      this.state = {
        ...this.state,
        expandedFolders: new Set([...this.state.expandedFolders, folderId])
      };
      const node = this.state.treeNodes.get(folderId);
      if (node && node.type === "folder") {
        node.isExpanded = true;
      }
      this.emit();
    }
  }

  public collapseFolder(folderId: string): void {
    if (this.state.expandedFolders.has(folderId)) {
      const newExpanded = new Set(this.state.expandedFolders);
      newExpanded.delete(folderId);
      this.state = {
        ...this.state,
        expandedFolders: newExpanded
      };
      const node = this.state.treeNodes.get(folderId);
      if (node && node.type === "folder") {
        node.isExpanded = false;
      }
      this.emit();
    }
  }

  public toggleFolder(folderId: string): void {
    if (this.state.expandedFolders.has(folderId)) {
      this.collapseFolder(folderId);
    } else {
      this.expandFolder(folderId);
    }
  }

  public setChildren(folderId: string, children: ExplorerTreeNode[]): void {
    const folderNode = this.state.treeNodes.get(folderId);
    if (!folderNode || folderNode.type !== "folder") return;

    const newTreeNodes = new Map(this.state.treeNodes);
    const updatedFolderNode = {
      ...folderNode,
      children: children.map((c) => c.id)
    } as ExplorerFolderNode;

    newTreeNodes.set(folderId, updatedFolderNode);
    for (const child of children) {
      newTreeNodes.set(child.id, child);
    }

    this.state = {
      ...this.state,
      treeNodes: newTreeNodes
    };
    this.emit();
  }

  public setPreviewFileId(fileId: string | null): void {
    this.state = {
      ...this.state,
      previewFileId: fileId
    };
    this.emit();
  }

  public getFolders(): ExplorerFolder[] {
    return this.state.folders;
  }

  public getTreeNodes(): Map<string, ExplorerTreeNode> {
    return this.state.treeNodes;
  }

  public getExpandedFolders(): Set<string> {
    return this.state.expandedFolders;
  }

  public getPreviewFileId(): string | null {
    return this.state.previewFileId;
  }

  public getSelectedItemId(): string | null {
    return this.state.selectedItemId;
  }

  public setSelectedItemId(itemId: string | null): void {
    this.state = {
      ...this.state,
      selectedItemId: itemId
    };
    this.emit();
  }

  public getSelectedFolderId(): string | null {
    return this.state.selectedItemId;
  }

  public setSelectedFolderId(folderId: string | null): void {
    this.state = {
      ...this.state,
      selectedItemId: folderId
    };
    this.emit();
  }

  public getRootNodes(): ExplorerFolderNode[] {
    return this.state.folders
      .map((f) => this.state.treeNodes.get(f.id))
      .filter((n): n is ExplorerFolderNode => n !== undefined && n.type === "folder");
  }

  public getChildNodes(parentId: string): ExplorerTreeNode[] {
    const parent = this.state.treeNodes.get(parentId);
    if (!parent || parent.type !== "folder") return [];
    return parent.children
      .map((id) => this.state.treeNodes.get(id))
      .filter((n): n is ExplorerTreeNode => n !== undefined);
  }

  public updateFileNode(fileId: string, file: ExplorerFileNode["file"]): void {
    const node = this.state.treeNodes.get(fileId);
    if (node && node.type === "file") {
      const newTreeNodes = new Map(this.state.treeNodes);
      newTreeNodes.set(fileId, { ...node, file });
      this.state = {
        ...this.state,
        treeNodes: newTreeNodes
      };
      this.emit();
    }
  }

  public markFileOpen(fileId: string, isOpen: boolean): void {
    const node = this.state.treeNodes.get(fileId);
    if (node && node.type === "file") {
      const newTreeNodes = new Map(this.state.treeNodes);
      newTreeNodes.set(fileId, { ...node, isOpen });
      this.state = {
        ...this.state,
        treeNodes: newTreeNodes
      };
      this.emit();
    }
  }

  public markFolderLoaded(folderId: string): void {
    const node = this.state.treeNodes.get(folderId);
    if (node && node.type === "folder") {
      const newTreeNodes = new Map(this.state.treeNodes);
      newTreeNodes.set(folderId, { ...node, loaded: true } as ExplorerFolderNode);
      this.state = {
        ...this.state,
        treeNodes: newTreeNodes
      };
      this.emit();
    }
  }

  public isFolderLoaded(folderId: string): boolean {
    const node = this.state.treeNodes.get(folderId);
    return node?.type === "folder" && node.loaded;
  }
}

let explorerStoreInstance: ExplorerStore | null = null;

export function getExplorerStore(): ExplorerStore {
  if (!explorerStoreInstance) {
    explorerStoreInstance = new ExplorerStore();
  }
  return explorerStoreInstance;
}

export function createExplorerStore(): ExplorerStore {
  explorerStoreInstance = new ExplorerStore();
  return explorerStoreInstance;
}
