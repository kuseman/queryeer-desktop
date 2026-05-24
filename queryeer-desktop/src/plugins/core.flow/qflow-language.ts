import type * as monacoType from "monaco-editor";
import { FLOW_MONACO_LANGUAGE_ID } from "../../contracts/flow/constants";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { getQflowCompletionsAtPosition } from "./qflow-completion";
import { parseQflowDocument } from "./qflow-parser";
import { getFlowStateStore } from "./flow-state";
import {
  FLOW_CODELENS_NOOP_COMMAND_ID,
  FLOW_CONFIGURE_NODE_COMMAND_ID,
  FLOW_RUN_NODE_COMMAND_ID,
  FLOW_RUN_TO_NODE_COMMAND_ID,
  getQflowCodeLens
} from "./qflow-codelens";
import {
  configureActiveFlowNode,
  runActiveFlowNode,
  runActiveFlowToNode
} from "./flow-command-handlers";

let monacoModuleInstance: typeof monacoType | null = null;
let qflowLanguageSetup = false;
const qflowCodeLensListeners = new Set<(event: monacoType.languages.CodeLensProvider) => void>();
let qflowCodeLensProviderRef: monacoType.languages.CodeLensProvider | null = null;

function notifyQflowCodeLensChanged(): void {
  if (!qflowCodeLensProviderRef) {
    return;
  }
  for (const listener of qflowCodeLensListeners) {
    listener(qflowCodeLensProviderRef);
  }
}

function onDidChangeQflowCodeLens(
  listener: (event: monacoType.languages.CodeLensProvider) => void
): monacoType.IDisposable {
  qflowCodeLensListeners.add(listener);
  return {
    dispose: () => {
      qflowCodeLensListeners.delete(listener);
    }
  };
}

async function getMonaco(): Promise<typeof monacoType> {
  if (!monacoModuleInstance) {
    monacoModuleInstance = await import("monaco-editor");
  }
  return monacoModuleInstance;
}

export async function setupQflowLanguage(): Promise<void> {
  if (qflowLanguageSetup) {
    return;
  }
  qflowLanguageSetup = true;

  const monaco = await getMonaco();
  registerFlowMonacoCommands(monaco);
  getFlowStateStore().subscribe(() => {
    notifyQflowCodeLensChanged();
  });
  monaco.languages.register({ id: FLOW_MONACO_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(FLOW_MONACO_LANGUAGE_ID, {
    tokenizer: {
      root: [
        [/^%%queryeer-flow\b.*$/, "keyword"],
        [/^%%\s*$/, "keyword"],
        [/^\s*[A-Za-z_][A-Za-z0-9_.-]*\s*:/, "attribute.name"],
        [/"[^"\\]*(?:\\.[^"\\]*)*"/, "string"],
        [/'[^'\\]*(?:\\.[^'\\]*)*'/, "string"],
        [/\btrue\b|\bfalse\b|\bnull\b/, "keyword"],
        [/[-+]?[0-9]+(?:\.[0-9]+)?/, "number"],
      ]
    }
  });

  monaco.languages.registerCompletionItemProvider(FLOW_MONACO_LANGUAGE_ID, {
    triggerCharacters: [".", ":", " "],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: position.column
      };

      const lineContent = model.getLineContent(position.lineNumber);
      const document = parseQflowDocument(model.getValue());
      const completions = getQflowCompletionsAtPosition(
        document,
        position.lineNumber,
        position.column,
        lineContent
      );

      return {
        suggestions: completions.map((completion) => ({
          label: completion.label,
          kind: mapCompletionKind(monaco, completion.kind),
          insertText: completion.insertText,
          detail: completion.detail,
          documentation: completion.documentation,
          sortText: completion.sortText,
          insertTextRules: completion.insertAsSnippet
            ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
            : undefined,
          range
        }))
      };
    }
  });

  const codeLensProvider: monacoType.languages.CodeLensProvider = {
    onDidChange: onDidChangeQflowCodeLens,
    provideCodeLenses(model) {
      const document = parseQflowDocument(model.getValue());
      const fileId = resolveQflowCodeLensFileId(
        model.uri.toString(),
        getEditorRegistryHost().getActiveEditor()?.fileId ?? undefined
      );
      const execution = fileId ? getFlowStateStore().getSnapshot(fileId).execution : undefined;
      const lenses = getQflowCodeLens({ document, execution });
      return {
        lenses: lenses.flatMap((lens) => lens.commands.map((command, index) => ({
          range: {
            startLineNumber: lens.lineNumber,
            startColumn: 1,
            endLineNumber: lens.lineNumber,
            endColumn: 1
          },
          id: `${lens.lineNumber}:${index}`,
          command: command.id
            ? {
                id: command.id,
                title: command.title,
                arguments: command.arguments
              }
            : undefined
        }))),
        dispose: () => {}
      };
    }
  };
  qflowCodeLensProviderRef = codeLensProvider;
  monaco.languages.registerCodeLensProvider(FLOW_MONACO_LANGUAGE_ID, codeLensProvider);
}

function registerFlowMonacoCommands(monaco: typeof monacoType): void {
  monaco.editor.registerCommand(FLOW_CODELENS_NOOP_COMMAND_ID, () => {});
  monaco.editor.registerCommand(FLOW_RUN_NODE_COMMAND_ID, (_accessor, nodeId?: unknown) => {
    runActiveFlowNode(typeof nodeId === "string" ? nodeId : undefined);
  });
  monaco.editor.registerCommand(FLOW_RUN_TO_NODE_COMMAND_ID, (_accessor, nodeId?: unknown) => {
    runActiveFlowToNode(typeof nodeId === "string" ? nodeId : undefined);
  });
  monaco.editor.registerCommand(FLOW_CONFIGURE_NODE_COMMAND_ID, (_accessor, nodeId?: unknown) => {
    configureActiveFlowNode(typeof nodeId === "string" ? nodeId : undefined);
  });
}

export function resolveQflowCodeLensFileId(uri: string, activeFileId?: string): string | undefined {
  return getFileIdFromModelUri(uri) ?? activeFileId;
}

function getFileIdFromModelUri(uri: string): string | undefined {
  const match = /fileId=([^&]+)/.exec(uri);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

function mapCompletionKind(
  monaco: typeof monacoType,
  kind: "keyword" | "function" | "variable" | "field" | "module" | "snippet" | "property"
): monacoType.languages.CompletionItemKind {
  switch (kind) {
    case "keyword":
      return monaco.languages.CompletionItemKind.Keyword;
    case "function":
      return monaco.languages.CompletionItemKind.Function;
    case "variable":
      return monaco.languages.CompletionItemKind.Variable;
    case "field":
      return monaco.languages.CompletionItemKind.Field;
    case "module":
      return monaco.languages.CompletionItemKind.Module;
    case "snippet":
      return monaco.languages.CompletionItemKind.Snippet;
    case "property":
      return monaco.languages.CompletionItemKind.Property;
    default:
      return monaco.languages.CompletionItemKind.Text;
  }
}
