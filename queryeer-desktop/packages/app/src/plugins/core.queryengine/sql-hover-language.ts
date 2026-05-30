import type * as monacoType from "monaco-editor";

import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { SqlHoverInvokePayload, SqlHoverInvokeResult } from "@queryeer/api/backend/Types";
import { getFilesRegistry } from "../core.commands/files-registry-accessor";
import { getRegisteredQueryExecutableEngines } from "./engine-registration";
import { getQueryEngineService } from "./QueryEngineService";

let monacoModuleInstance: typeof monacoType | null = null;
let sqlHoverSetup = false;
const JDBC_CTX_DATABASE = "core.queryengine.jdbc.database";

async function getMonaco(): Promise<typeof monacoType>
{
  if (!monacoModuleInstance) {
    monacoModuleInstance = await import("monaco-editor");
  }
  return monacoModuleInstance;
}

function normalizeUri(uri: string): string {
  return uri.toLowerCase().replace(/%3a/g, ":");
}

function findFileForModelUri(uri: string): FileEntity | undefined {
  const filesRegistry = getFilesRegistry();
  if (!filesRegistry) {
    return undefined;
  }
  const normalized = normalizeUri(uri);
  return filesRegistry
    .listFiles()
    .find((file) => normalizeUri(file.uri) === normalized);
}

function resolveEngineId(file: FileEntity): string | undefined {
  if (file.engineBinding?.engineId) {
    return file.engineBinding.engineId;
  }
  const inferred = getRegisteredQueryExecutableEngines().find((entry) =>
    entry.mimeTypes.includes(file.mimeType)
  );
  return inferred?.engineId;
}

function computeHoverRange(
  text: string,
  cursorLine: number,
  cursorColumn: number,
  token: string | undefined
): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | undefined {
  if (!token) {
    return undefined;
  }
  const lines = text.split("\n");
  if (cursorLine < 1 || cursorLine > lines.length) {
    return undefined;
  }
  const line = lines[cursorLine - 1];
  const col0 = Math.min(cursorColumn - 1, line.length);
  // Walk backward/forward from cursor to find the token boundaries
  const isIdentChar = (c: string) => /[a-zA-Z0-9_.[\]"`]/.test(c);
  let start = col0;
  while (start > 0 && isIdentChar(line[start - 1])) {
    start--;
  }
  let end = col0;
  while (end < line.length && isIdentChar(line[end])) {
    end++;
  }
  if (start >= end) {
    return undefined;
  }
  return {
    startLineNumber: cursorLine,
    startColumn: start + 1,
    endLineNumber: cursorLine,
    endColumn: end + 1
  };
}

export async function setupSqlHoverLanguage(): Promise<void> {
  if (sqlHoverSetup) {
    return;
  }
  sqlHoverSetup = true;

  const monaco = await getMonaco();
  monaco.languages.registerHoverProvider("sql", {
    async provideHover(model, position, token) {
      const file = findFileForModelUri(model.uri.toString());
      if (!file) {
        return null;
      }
      const engineId = resolveEngineId(file);
      if (!engineId) {
        return null;
      }

      const payload: SqlHoverInvokePayload = {
        fileId: file.fileId,
        text: model.getValue(),
        connectionId: file.engineBinding?.connectionId,
        database: typeof file.metadata?.[JDBC_CTX_DATABASE] === "string"
          ? String(file.metadata[JDBC_CTX_DATABASE])
          : undefined,
        cursor: {
          line: position.lineNumber,
          column: position.column
        }
      };

      try {
        const result = await getQueryEngineService().invoke({
          engineId,
          fileId: file.fileId,
          action: "sql.hover",
          payload
        }, { silent: true }) as SqlHoverInvokeResult | null;

        if (token.isCancellationRequested || !result?.contents?.length) {
          return null;
        }

        const rawText = model.getValue();
        const range = computeHoverRange(rawText, position.lineNumber, position.column, result.token);

        return {
          range,
          contents: result.contents.map((c) => ({
            value: c.value,
            isTrusted: c.isTrusted ?? false
          }))
        };
      }
      catch {
        return null;
      }
    }
  });
}
