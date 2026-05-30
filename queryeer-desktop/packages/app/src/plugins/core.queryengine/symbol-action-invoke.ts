import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { SymbolAtPositionInvokePayload } from "@queryeer/api/backend/Types";
import type { SymbolAtPositionResult } from "./symbol-action-types";
import { getQueryEngineService } from "./QueryEngineService";
import { getRegisteredQueryExecutableEngines } from "./engine-registration";

const JDBC_CTX_DATABASE = "core.queryengine.jdbc.database";

function resolveEngineId(file: FileEntity): string | undefined {
  if (file.engineBinding?.engineId) {
    return file.engineBinding.engineId;
  }
  const inferred = getRegisteredQueryExecutableEngines().find((entry) =>
    entry.mimeTypes.includes(file.mimeType)
  );
  return inferred?.engineId;
}

/**
 * Resolves the symbol at a given cursor position by invoking the backend.
 * Returns null if the backend is unavailable or no symbol is found at that position.
 */
export async function resolveSymbolAtPosition(
  position: { line: number; column: number },
  file: FileEntity,
  modelContent: string
): Promise<SymbolAtPositionResult | null> {
  const engineId = resolveEngineId(file);
  if (!engineId) return null;

  const payload: SymbolAtPositionInvokePayload = {
    fileId: file.fileId,
    text: modelContent,
    cursor: { line: position.line, column: position.column },
    connectionId: file.engineBinding?.connectionId,
    database:
      typeof file.metadata?.[JDBC_CTX_DATABASE] === "string"
        ? String(file.metadata[JDBC_CTX_DATABASE])
        : undefined
  };

  try {
    const result = await getQueryEngineService().invoke(
      { engineId, fileId: file.fileId, action: "sql.symbolAtPosition", payload },
      { silent: true }
    ) as SymbolAtPositionResult | null;
    return result;
  } catch {
    return null;
  }
}
