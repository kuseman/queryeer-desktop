import type * as monacoType from "monaco-editor";
import type { CtxVar, CtxMethod } from "./when-expression-types";
import { getRegisteredWhenExpressionVariables } from "./when-expression-variable-registry";
import { getRegisteredWhenExpressionTemplates } from "./when-expression-template-registry";
import { getExpressionRuntime } from "../core.expressions/runtime";

export type { CtxVar, CtxMethod };

// ---------------------------------------------------------------------------
// Monaco helpers
// ---------------------------------------------------------------------------

let monacoModuleInstance: typeof monacoType | null = null;

export async function getMonaco(): Promise<typeof monacoType> {
  if (!monacoModuleInstance) {
    monacoModuleInstance = await import("monaco-editor");
  }
  return monacoModuleInstance;
}

// ---------------------------------------------------------------------------
// when-expression language: base context variables and string methods
// ---------------------------------------------------------------------------

export const WHEN_LANGUAGE_ID = "when-expression";

/** Base variables always available regardless of which engine plugins are loaded. */
export const CONTEXT_VARIABLES: CtxVar[] = [
  { name: "languageId", type: "string", description: "Language ID of the active editor (e.g. 'sql', 'json')" },
  { name: "activeFile.mimeType", type: "string", description: "MIME type of the active file (e.g. 'application/sql')" },
  { name: "selectedText", type: "string", description: "Text currently selected in the editor" },
  { name: "hasSelection", type: "boolean", description: "True when text is selected in the editor" },
  { name: "hasActiveFile", type: "boolean", description: "True when any file is open" },
  { name: "hasActiveTextEditor", type: "boolean", description: "True when a text editor is active" },
  { name: "editorTextFocus", type: "boolean", description: "True when the editor text area has keyboard focus" },
  { name: "hasActiveQueryExecutableFile", type: "boolean", description: "True when the active file can be executed as a query" },
  { name: "hasActiveQueryPlanDialect", type: "boolean", description: "True when the active query file uses a dialect that supports query plans" },
  { name: "backendHealthy", type: "boolean", description: "True when the backend service is running and healthy" },
];

export const STRING_METHODS: CtxMethod[] = [];

type PathNode = {
  children: Set<string>;
  terminalType?: CtxVar["type"];
  description?: string;
};

type FunctionPathNode = {
  children: Set<string>;
  isFunction?: boolean;
  signature?: string;
  description?: string;
};

const modelScopedContextVariables = new Map<string, CtxVar[]>();

function dedupeContextVariables(vars: CtxVar[]): CtxVar[] {
  const seen = new Set<string>();
  const result: CtxVar[] = [];

  for (const variable of vars) {
    const name = variable.name.trim();
    if (name.length === 0 || seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push({
      ...variable,
      name
    });
  }

  return result;
}

function getContextVariablesForModel(modelUri: string): CtxVar[] {
  return dedupeContextVariables([
    ...CONTEXT_VARIABLES,
    ...getRegisteredWhenExpressionVariables(),
    ...(modelScopedContextVariables.get(modelUri) ?? [])
  ]);
}

export function setWhenExpressionModelVariables(modelUri: string, vars: CtxVar[]): void {
  modelScopedContextVariables.set(modelUri, dedupeContextVariables(vars));
}

export function clearWhenExpressionModelVariables(modelUri: string): void {
  modelScopedContextVariables.delete(modelUri);
}

function buildPathIndex(vars: CtxVar[]): Map<string, PathNode> {
  const index = new Map<string, PathNode>();

  const ensure = (path: string): PathNode => {
    const existing = index.get(path);
    if (existing) return existing;
    const created: PathNode = { children: new Set<string>() };
    index.set(path, created);
    return created;
  };

  ensure("");
  for (const v of vars) {
    const segments = v.name.split(".").filter((s) => s.length > 0);
    let currentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const parent = ensure(currentPath);
      parent.children.add(seg);
      currentPath = currentPath ? `${currentPath}.${seg}` : seg;
      const node = ensure(currentPath);
      if (i === segments.length - 1) {
        node.terminalType = v.type;
        node.description = v.description;
      }
    }
  }
  return index;
}

function getQualifierBeforeDot(lineContent: string, cursorColumn: number): string | null {
  const beforeCursor = lineContent.slice(0, Math.max(0, cursorColumn - 1));
  const match = /([A-Za-z_][A-Za-z0-9_.]*)\.$/.exec(beforeCursor);
  return match?.[1] ?? null;
}

function getBuiltInFunctionSuggestions(monaco: typeof monacoType, range: monacoType.IRange): monacoType.languages.CompletionItem[] {
  return getExpressionRuntime()
    .getFunctionRegistry()
    .listFunctions()
    .map(({ fqName, meta }) => ({
      label: fqName,
      kind: monaco.languages.CompletionItemKind.Function,
      detail: meta?.signature ?? "Expression function",
      documentation: meta?.description,
      insertText: fqName,
      sortText: `050_${fqName}`,
      range,
    }));
}

function buildFunctionPathIndex(): Map<string, FunctionPathNode> {
  const index = new Map<string, FunctionPathNode>();
  const ensure = (path: string): FunctionPathNode => {
    const existing = index.get(path);
    if (existing) return existing;
    const created: FunctionPathNode = { children: new Set<string>() };
    index.set(path, created);
    return created;
  };

  ensure("");
  for (const { fqName, meta } of getExpressionRuntime().getFunctionRegistry().listFunctions()) {
    const segments = fqName.split(".").filter((s) => s.length > 0);
    let currentPath = "";
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      ensure(currentPath).children.add(seg);
      currentPath = currentPath ? `${currentPath}.${seg}` : seg;
      const node = ensure(currentPath);
      if (i === segments.length - 1) {
        node.isFunction = true;
        node.signature = meta?.signature;
        node.description = meta?.description;
      }
    }
  }

  return index;
}

/** Returns base variables plus any registered by plugins. */
export function getAllContextVariables(): CtxVar[] {
  return dedupeContextVariables([...CONTEXT_VARIABLES, ...getRegisteredWhenExpressionVariables()]);
}

let whenLanguageSetup = false;

export async function setupWhenExpressionLanguage(): Promise<void> {
  if (whenLanguageSetup) return;
  whenLanguageSetup = true;

  const monaco = await getMonaco();

  monaco.languages.register({ id: WHEN_LANGUAGE_ID });

  monaco.languages.setMonarchTokensProvider(WHEN_LANGUAGE_ID, {
    keywords: ["true", "false"],
    tokenizer: {
      root: [
        [/\b(true|false)\b/, "keyword"],
        [/'[^']*'/, "string"],
        [/"[^"]*"/, "string"],
        [/[0-9]+/, "number"],
        [/&&|\|\|/, "operator"],
        [/[!=]=/, "operator"],
        [/!/, "operator"],
        [/[A-Za-z_][A-Za-z0-9_.]*/, "identifier"],
      ]
    }
  });

  monaco.languages.registerCompletionItemProvider(WHEN_LANGUAGE_ID, {
    triggerCharacters: ["."],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: position.column,
      };

      const lineContent = model.getLineContent(position.lineNumber);
      const qualifier = getQualifierBeforeDot(lineContent, position.column);
      const allVariables = getContextVariablesForModel(model.uri.toString());
      const pathIndex = buildPathIndex(allVariables);
      const functionPathIndex = buildFunctionPathIndex();

      if (qualifier) {
        const node = pathIndex.get(qualifier);
        const childSuggestions: monacoType.languages.CompletionItem[] = [];
        if (node) {
          for (const child of [...node.children].sort((a, b) => a.localeCompare(b))) {
            const nextPath = `${qualifier}.${child}`;
            const childNode = pathIndex.get(nextPath);
            const hasChildren = !!childNode && childNode.children.size > 0;
            childSuggestions.push({
              label: child,
              kind: hasChildren
                ? monaco.languages.CompletionItemKind.Module
                : (childNode?.terminalType === "boolean"
                    ? monaco.languages.CompletionItemKind.Variable
                    : monaco.languages.CompletionItemKind.Field),
              detail: hasChildren
                ? "Context path"
                : (childNode?.terminalType ? `(${childNode.terminalType})` : "Context value"),
              documentation: childNode?.description,
              insertText: child,
              sortText: `100_${child}`,
              range,
            });
          }
        }

        const currentType = node?.terminalType;
        const methodSuggestions = currentType === "string"
          ? STRING_METHODS.map((m) => ({
              label: m.name,
              kind: monaco.languages.CompletionItemKind.Method,
              detail: m.signature,
              documentation: m.description,
              insertText: `${m.name}('$1')`,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              sortText: `200_${m.name}`,
              range,
            }))
          : [];

        const functionChildSuggestions: monacoType.languages.CompletionItem[] = [];
        const functionNode = functionPathIndex.get(qualifier);
        if (functionNode) {
          for (const child of [...functionNode.children].sort((a, b) => a.localeCompare(b))) {
            const nextPath = `${qualifier}.${child}`;
            const nextNode = functionPathIndex.get(nextPath);
            functionChildSuggestions.push({
              label: child,
              kind: nextNode?.isFunction
                ? monaco.languages.CompletionItemKind.Function
                : monaco.languages.CompletionItemKind.Module,
              detail: nextNode?.isFunction
                ? (nextNode.signature ?? "Expression function")
                : "Function namespace",
              documentation: nextNode?.description,
              insertText: child,
              sortText: `060_${child}`,
              range,
            });
          }
        }

        return {
          suggestions: [...functionChildSuggestions, ...childSuggestions, ...methodSuggestions]
        };
      }

      const varSuggestions = allVariables.map((v) => ({
        label: v.name,
        kind: v.type === "boolean"
          ? monaco.languages.CompletionItemKind.Variable
          : monaco.languages.CompletionItemKind.Field,
        detail: `(${v.type})`,
        documentation: v.description,
        insertText: v.name,
        sortText: `100_${v.name}`,
        range,
      }));

      const topLevelObjectSuggestions = Array.from(pathIndex.get("")?.children ?? [])
        .sort((a, b) => a.localeCompare(b))
        .map((name) => ({
          label: name,
          kind: monaco.languages.CompletionItemKind.Module,
          detail: "Context object",
          insertText: name,
          sortText: `090_${name}`,
          range,
        }));

      const keywordSuggestions = [
        { label: "true", kind: monaco.languages.CompletionItemKind.Keyword, insertText: "true", range },
        { label: "false", kind: monaco.languages.CompletionItemKind.Keyword, insertText: "false", range },
      ];

      const templateSuggestions = getRegisteredWhenExpressionTemplates().map((template) => ({
        label: template.name,
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: "When template",
        documentation: template.description ?? template.when,
        insertText: template.when,
        sortText: `000_${template.name}`,
        range,
      }));

      const fnSuggestions = getBuiltInFunctionSuggestions(monaco, range);

      return { suggestions: [...templateSuggestions, ...fnSuggestions, ...topLevelObjectSuggestions, ...varSuggestions, ...keywordSuggestions] };
    }
  });
}
