import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import { JDBC_NAV_DB_KEY, type JdbcSelectedDatabase } from "./jdbc-navigation-types";
import { getFilesRegistry } from "../core.commands/files-registry-accessor";

type Props = {
  file: FileEntity | undefined;
};

export function JdbcConnectionStatus({ file }: Props): JSX.Element | null {
  if (!file || file.engineBinding?.engineId !== "jdbc") {
    return null;
  }

  const connectionId = file.engineBinding.connectionId;
  if (!connectionId) {
    return null;
  }

  const connections = getConfiguredJdbcConnections();
  const match = connections.find((c) => c.connectionId === connectionId);
  if (!match) {
    return null;
  }

  const filesRegistry = getFilesRegistry();
  const raw = filesRegistry?.getEditorState(file.fileId, JDBC_NAV_DB_KEY);
  const selectedDatabase: JdbcSelectedDatabase | undefined =
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as Record<string, unknown>).connectionId === "string" &&
    typeof (raw as Record<string, unknown>).database === "string"
      ? (raw as JdbcSelectedDatabase)
      : undefined;

  const database =
    selectedDatabase?.connectionId === connectionId ? selectedDatabase.database : undefined;

  const color = match.color;
  const title = match.title?.trim() || connectionId;

  return (
    <span style={color ? { color } : undefined}>
      {title}{database ? ` | ${database}` : ""}
    </span>
  );
}
