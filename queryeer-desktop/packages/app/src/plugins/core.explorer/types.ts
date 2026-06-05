import type { FileEntity } from "@queryeer/api/files/FileEntity";

export type ExplorerFolder = {
  id: string;
  uri: string;
  name: string;
  label?: string;
  filterRegex: string;
};

export type ExplorerTreeNode =
  | ExplorerFileNode
  | ExplorerFolderNode;

export type ExplorerFileNode = {
  type: "file";
  id: string;
  name: string;
  uri: string;
  parentId: string;
  isOpen: boolean;
  file?: FileEntity;
};

export type ExplorerFolderNode = {
  type: "folder";
  id: string;
  name: string;
  uri: string;
  parentId: string | null;
  isExpanded: boolean;
  children: string[];
  loaded: boolean;
};

export type ExplorerState = {
  folders: ExplorerFolder[];
  treeNodes: Map<string, ExplorerTreeNode>;
  expandedFolders: Set<string>;
  previewFileId: string | null;
};

export type ExplorerActions = {
  addFolder: (uri: string) => void;
  removeFolder: (folderId: string) => void;
  expandFolder: (folderId: string) => void;
  collapseFolder: (folderId: string) => void;
  setPreviewFileId: (fileId: string | null) => void;
  getTreeForFolder: (folderId: string) => ExplorerTreeNode[];
  loadChildren: (folderId: string) => Promise<void>;
};
