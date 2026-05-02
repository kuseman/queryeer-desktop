export type JdbcSchemaObject = {
  id: string;
  name: string;
  kind: string;
  children: JdbcSchemaObject[];
  attributes: Record<string, unknown>;
};

export type JdbcTreeNode = {
  id: string;
  connectionId: string;
  kind: string;
  name: string;
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

export const JDBC_NAV_DB_KEY = "jdbc.navigation.selectedDatabase";
