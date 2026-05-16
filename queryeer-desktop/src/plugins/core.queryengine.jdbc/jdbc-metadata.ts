import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { JDBC_NAV_DB_KEY } from "./jdbc-navigation-types";

export const JDBC_CTX_DATABASE = "core.queryengine.jdbc.database";
export const JDBC_CTX_CONNECTION_TITLE = "core.queryengine.jdbc.connectionTitle";
export const JDBC_CTX_DIALECT_ID = "core.queryengine.jdbc.dialectId";

export function writeJdbcContextMetadata(
  fileId: string,
  connectionId: string | undefined,
  database: string | undefined,
  files: Pick<FilesRegistry, "getFile" | "updateFile">
): void {
  const file = files.getFile(fileId);
  if (!file) return;

  const metadata = { ...(file.metadata ?? {}) };

  if (connectionId) {
    const conn = getConfiguredJdbcConnections().find((c) => c.connectionId === connectionId);
    metadata[JDBC_CTX_CONNECTION_TITLE] = conn?.title?.trim() || connectionId;
    metadata[JDBC_CTX_DIALECT_ID] = conn?.dialectId ?? "jdbc";
  } else {
    delete metadata[JDBC_CTX_CONNECTION_TITLE];
    delete metadata[JDBC_CTX_DIALECT_ID];
  }

  if (database) {
    metadata[JDBC_CTX_DATABASE] = database;
  } else {
    delete metadata[JDBC_CTX_DATABASE];
  }

  files.updateFile(fileId, { metadata });
}

export function initJdbcFileBinding(
  fileId: string,
  connectionId: string,
  database: string | undefined,
  files: Pick<FilesRegistry, "getFile" | "updateFile" | "setEditorState">
): void {
  if (database) {
    files.setEditorState(fileId, JDBC_NAV_DB_KEY, { connectionId, database });
  }
  files.updateFile(fileId, {
    engineBinding: { engineId: "jdbc", connectionId }
  });
  writeJdbcContextMetadata(fileId, connectionId, database, files);
}
