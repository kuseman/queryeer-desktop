import type * as monacoType from "monaco-editor";

import type { FileEntity } from "../../contracts/files/FileEntity";
import type { SqlCompleteInvokePayload, SqlCompleteInvokeResult, SqlCompletionItem } from "../../contracts/backend/Types";
import { getFilesRegistry } from "../core.commands/files-registry-accessor";
import { getRegisteredQueryExecutableEngines } from "./engine-registration";
import { getQueryEngineService } from "./QueryEngineService";

let monacoModuleInstance: typeof monacoType | null = null;
let sqlCompletionSetup = false;
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

function mapKind(monaco: typeof monacoType, kind: string | undefined): monacoType.languages.CompletionItemKind {
  switch (kind) {
    case "keyword": return monaco.languages.CompletionItemKind.Keyword;
    case "function":
    case "procedure": return monaco.languages.CompletionItemKind.Function;
    case "table":
    case "view": return monaco.languages.CompletionItemKind.Class;
    case "column": return monaco.languages.CompletionItemKind.Field;
    case "schema":
    case "database": return monaco.languages.CompletionItemKind.Module;
    case "snippet": return monaco.languages.CompletionItemKind.Snippet;
    case "variable":
    case "parameter": return monaco.languages.CompletionItemKind.Variable;
    case "operator": return monaco.languages.CompletionItemKind.Operator;
    default: return monaco.languages.CompletionItemKind.Text;
  }
}

function toMonacoRange(position: monacoType.Position, item: SqlCompletionItem): monacoType.IRange {
  if (!item.replaceRange) {
    return {
      startLineNumber: position.lineNumber,
      startColumn: position.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column
    };
  }
  return {
    startLineNumber: item.replaceRange.startLine,
    startColumn: item.replaceRange.startColumn,
    endLineNumber: item.replaceRange.endLine,
    endColumn: item.replaceRange.endColumn
  };
}

export async function setupSqlCompletionLanguage(): Promise<void> {
  if (sqlCompletionSetup) {
    return;
  }
  sqlCompletionSetup = true;

  const monaco = await getMonaco();
  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " "],
    async provideCompletionItems(model, position, context, token) {
      const file = findFileForModelUri(model.uri.toString());
      if (!file) {
        console.warn("[sql-completion] No file found in registry for URI:", model.uri.toString());
        return { suggestions: [] };
      }
      const engineId = resolveEngineId(file);
      if (!engineId) {
        console.warn("[sql-completion] No engineId resolved for file:", file.uri, "mimeType:", file.mimeType, "engineBinding:", file.engineBinding);
        return { suggestions: [] };
      }

      const payload: SqlCompleteInvokePayload = {
        fileId: file.fileId,
        version: file.version,
        text: model.getValue(),
        connectionId: file.engineBinding?.connectionId,
        database: typeof file.metadata?.[JDBC_CTX_DATABASE] === "string"
          ? String(file.metadata[JDBC_CTX_DATABASE])
          : undefined,
        cursor: {
          line: position.lineNumber,
          column: position.column
        },
        trigger: {
          kind: context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerCharacter ? "triggerCharacter"
            : context.triggerKind === monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions ? "retrigger"
              : "invoke",
          character: context.triggerCharacter
        },
        limits: { maxItems: 100 }
      };

      try {
        const result = await getQueryEngineService().invoke({
          engineId,
          fileId: file.fileId,
          action: "sql.complete",
          payload
        }, { silent: true }) as SqlCompleteInvokeResult;

        if (token.isCancellationRequested || !result?.items) {
          return { suggestions: [] };
        }

        const suggestions = result.items.map((item) => ({
          label: item.label,
          kind: mapKind(monaco, item.kind),
          detail: item.detail,
          documentation: item.documentation,
          sortText: item.sortText,
          filterText: item.filterText,
          insertText: item.insertText ?? item.label,
          insertTextRules: item.insertTextFormat === "snippet"
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          commitCharacters: item.commitCharacters,
          range: toMonacoRange(position, item)
        }));

        return {
          suggestions,
          incomplete: Boolean(result.isIncomplete)
        };
      }
      catch {
        return { suggestions: [] };
      }
    }
  });
}
