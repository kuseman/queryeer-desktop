import type * as monacoType from "monaco-editor";
import type { CtxVar, CtxMethod } from "./when-expression-types";
import { getRegisteredWhenExpressionVariables } from "./when-expression-variable-registry";
import { getRegisteredWhenExpressionTemplates } from "./when-expression-template-registry";

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
  { name: "activeFileMimeType", type: "string", description: "MIME type of the active file (e.g. 'application/sql')" },
  { name: "selectedText", type: "string", description: "Text currently selected in the editor" },
  { name: "hasSelection", type: "boolean", description: "True when text is selected in the editor" },
  { name: "hasActiveFile", type: "boolean", description: "True when any file is open" },
  { name: "hasActiveTextEditor", type: "boolean", description: "True when a text editor is active" },
  { name: "editorTextFocus", type: "boolean", description: "True when the editor text area has keyboard focus" },
  { name: "hasActiveQueryExecutableFile", type: "boolean", description: "True when the active file can be executed as a query" },
  { name: "backendHealthy", type: "boolean", description: "True when the backend service is running and healthy" },
];

export const STRING_METHODS: CtxMethod[] = [
  { name: "contains", signature: "contains(substring)", description: "True if the string contains the given substring" },
  { name: "startsWith", signature: "startsWith(prefix)", description: "True if the string starts with the given prefix" },
  { name: "endsWith", signature: "endsWith(suffix)", description: "True if the string ends with the given suffix" },
  { name: "matches", signature: "matches(regex)", description: "True if the string matches the given regular expression" },
  { name: "lower", signature: "lower()", description: "Returns the string in lowercase — use with == or other methods" },
  { name: "upper", signature: "upper()", description: "Returns the string in uppercase — use with == or other methods" },
];

/** Returns base variables plus any registered by plugins. */
export function getAllContextVariables(): CtxVar[] {
  return [...CONTEXT_VARIABLES, ...getRegisteredWhenExpressionVariables()];
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
      const charBeforeWord = lineContent[word.startColumn - 2];

      if (charBeforeWord === ".") {
        return {
          suggestions: STRING_METHODS.map((m) => ({
            label: m.name,
            kind: monaco.languages.CompletionItemKind.Method,
            detail: m.signature,
            documentation: m.description,
            insertText: `${m.name}('$1')`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          }))
        };
      }

      // Read combined variable list at call time so plugin-registered vars are included.
      const varSuggestions = getAllContextVariables().map((v) => ({
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

      return { suggestions: [...templateSuggestions, ...varSuggestions, ...keywordSuggestions] };
    }
  });
}
