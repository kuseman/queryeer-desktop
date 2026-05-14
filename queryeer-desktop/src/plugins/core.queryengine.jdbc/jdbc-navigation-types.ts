export type NodeType = "container" | "structural" | "folder" | "object" | "property";

export type JdbcSchemaObject = {
  id: string;
  name: string;
  kind: string;
  nodeType?: NodeType;
  fullName?: string;
  children?: JdbcSchemaObject[] | null;
  attributes: Record<string, unknown>;
};

export type JdbcTreeNode = {
  id: string;
  connectionId: string;
  kind: string;
  nodeType: NodeType;
  name: string;
  fullName?: string;
  attributes: Record<string, unknown>;
  isExpanded: boolean;
  isLoaded: boolean;
  isLoading: boolean;
  loadError: string | undefined;
  childIds: string[];
};

export type JdbcConnectionTreeEntry = {
  connectionId: string;
  title: string;
  dialectId: string;
  rootNodeId: string;
};

export type JdbcSelectedDatabase = {
  connectionId: string;
  database: string;
};

export const JDBC_NAV_DB_KEY = "jdbc.navigation.selectedDatabase";
