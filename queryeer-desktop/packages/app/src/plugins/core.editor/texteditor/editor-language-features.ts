import type * as monacoType from "monaco-editor";
import {
  CompletionItemKind,
  type CancellationToken,
  type CompletionItem,
  type CompletionProvider,
  type Diagnostic,
  type DiagnosticsProvider,
  type Disposable,
  type HoverProvider,
  type SignatureHelpProvider,
  type TextDocument,
  type TextRange
} from "@queryeer/api/editor/EditorApi";
import { findFileForModelUri } from "../../core.commands/files-registry-accessor";

type MonacoLanguages = Pick<
  typeof monacoType.languages,
  | "registerCompletionItemProvider"
  | "registerHoverProvider"
  | "registerSignatureHelpProvider"
  | "CompletionItemKind"
  | "CompletionItemInsertTextRule"
>;

type MonacoEditor = Pick<
  typeof monacoType.editor,
  "getModels" | "onDidCreateModel" | "onDidChangeModelLanguage" | "onWillDisposeModel" | "setModelMarkers"
>;

/** The parts of Monaco the adapters use. */
type MonacoApi = {
  languages: MonacoLanguages;
  editor: MonacoEditor;
  MarkerSeverity: typeof monacoType.MarkerSeverity;
};

type LoadMonaco = () => Promise<MonacoApi>;

/** The open file a model shows, or undefined for a model that isn't one (e.g. a diff or a settings editor). */
type ResolveFileId = (modelUri: string) => string | undefined;

async function loadMonaco(): Promise<MonacoApi> {
  const monaco = await import("monaco-editor");
  return { languages: monaco.languages, editor: monaco.editor, MarkerSeverity: monaco.MarkerSeverity };
}

function resolveFileIdFromRegistry(modelUri: string): string | undefined {
  return findFileForModelUri(modelUri)?.fileId;
}

/** How long typing has to pause before diagnostics are asked for again. */
const DIAGNOSTICS_DELAY_MS = 500;

export type EditorLanguageFeatureRegistrars = {
  registerCompletionProvider: (languageId: string, provider: CompletionProvider) => Disposable;
  registerHoverProvider: (languageId: string, provider: HoverProvider) => Disposable;
  registerSignatureHelpProvider: (languageId: string, provider: SignatureHelpProvider) => Disposable;
  registerDiagnosticsProvider: (languageId: string, provider: DiagnosticsProvider) => Disposable;
};

/**
 * Creates the backing implementations of `editorLanguages.registerCompletionProvider`, `registerHoverProvider`,
 * `registerSignatureHelpProvider` and `registerDiagnosticsProvider`: adapters from the API's provider types to
 * Monaco's, which keep Monaco's types out of `@queryeer/api`.
 */
export function createEditorLanguageFeatureRegistrars(
  load: LoadMonaco = loadMonaco,
  resolveFileId: ResolveFileId = resolveFileIdFromRegistry,
  diagnosticsDelayMs: number = DIAGNOSTICS_DELAY_MS
): EditorLanguageFeatureRegistrars {
  const toDocument = (model: monacoType.editor.ITextModel): TextDocument => toTextDocument(model, resolveFileId(model.uri.toString()));
  let diagnosticsOwners = 0;

  return {
    registerCompletionProvider: (languageId, provider) =>
      registerWithMonaco("completion", languageId, provider, "provideCompletionItems", load, ({ languages }, id) =>
        languages.registerCompletionItemProvider(id, {
          ...(provider.triggerCharacters ? { triggerCharacters: [...provider.triggerCharacters] } : {}),
          provideCompletionItems: async (model, position, context, token) =>
            (await guarded("completion", id, async () => {
              const result = await provider.provideCompletionItems(
                toDocument(model),
                { lineNumber: position.lineNumber, column: position.column },
                { triggerKind: context.triggerKind as number, triggerCharacter: context.triggerCharacter },
                token
              );
              if (!result || token.isCancellationRequested) {
                return undefined;
              }
              const defaultRange = wordRanges(model, position);
              return {
                suggestions: (result.suggestions ?? []).map((item) => toMonacoCompletionItem(languages, item, defaultRange)),
                incomplete: Boolean(result.incomplete)
              };
            })) ?? { suggestions: [] }
        })),

    registerHoverProvider: (languageId, provider) =>
      registerWithMonaco("hover", languageId, provider, "provideHover", load, ({ languages }, id) =>
        languages.registerHoverProvider(id, {
          provideHover: async (model, position, token) =>
            (await guarded("hover", id, async () => {
              const hover = await provider.provideHover(toDocument(model), { lineNumber: position.lineNumber, column: position.column }, token);
              if (!hover || token.isCancellationRequested || !hover.contents?.length) {
                return undefined;
              }
              return {
                ...(hover.range ? { range: toMonacoRange(hover.range) } : {}),
                contents: hover.contents.map((content) => ({ value: content.value, isTrusted: content.isTrusted === true }))
              };
            })) ?? null
        })),

    registerSignatureHelpProvider: (languageId, provider) =>
      registerWithMonaco("signature help", languageId, provider, "provideSignatureHelp", load, ({ languages }, id) =>
        languages.registerSignatureHelpProvider(id, {
          ...(provider.signatureHelpTriggerCharacters
            ? { signatureHelpTriggerCharacters: [...provider.signatureHelpTriggerCharacters] }
            : {}),
          ...(provider.signatureHelpRetriggerCharacters
            ? { signatureHelpRetriggerCharacters: [...provider.signatureHelpRetriggerCharacters] }
            : {}),
          provideSignatureHelp: async (model, position, token) =>
            (await guarded("signature help", id, async () => {
              const help = await provider.provideSignatureHelp(toDocument(model), { lineNumber: position.lineNumber, column: position.column }, token);
              if (!help || token.isCancellationRequested || !help.signatures?.length) {
                return undefined;
              }
              return {
                value: {
                  activeSignature: help.activeSignature,
                  activeParameter: help.activeParameter,
                  signatures: help.signatures.map((signature) => ({
                    label: signature.label,
                    documentation: signature.documentation,
                    parameters: (signature.parameters ?? []).map((parameter) => ({
                      label: parameter.label,
                      documentation: parameter.documentation
                    }))
                  }))
                },
                dispose: () => {}
              };
            })) ?? null
        })),

    registerDiagnosticsProvider: (languageId, provider) => {
      // Each registration owns its markers, so providers for one language don't replace each other's
      const owner = `queryeer.diagnostics.${++diagnosticsOwners}`;
      return registerWithMonaco("diagnostics", languageId, provider, "provideDiagnostics", load, (monaco, id) =>
        watchDiagnostics(monaco, id, owner, provider, toDocument, diagnosticsDelayMs));
    }
  };
}

/**
 * Validates the registration, then registers with Monaco once it has loaded. Disposing before that skips the
 * registration; disposing after removes it.
 */
function registerWithMonaco(
  feature: string,
  languageId: string,
  provider: object | null | undefined,
  method: string,
  load: LoadMonaco,
  register: (monaco: MonacoApi, id: string) => monacoType.IDisposable
): Disposable {
  const id = typeof languageId === "string" ? languageId.trim() : "";
  if (!id) {
    throw new Error(`The language id of a ${feature} provider must be non-empty`);
  }
  if (!provider || typeof (provider as Record<string, unknown>)[method] !== "function") {
    throw new Error(`A ${feature} provider for "${id}" must have a ${method} method`);
  }

  let disposed = false;
  let registration: monacoType.IDisposable | undefined;
  void load()
    .then((monaco) => {
      if (!disposed) {
        registration = register(monaco, id);
      }
    })
    .catch((error: unknown) => {
      console.error(`[editorLanguages] Failed to register a ${feature} provider for "${id}"`, error);
    });

  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      registration?.dispose();
      registration = undefined;
    }
  };
}

/**
 * A provider is plugin code: one that throws, rejects or returns something that can't be mapped offers nothing, and
 * the editor keeps working.
 */
async function guarded<T>(feature: string, languageId: string, call: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await call();
  }
  catch (error) {
    console.error(`[editorLanguages] A ${feature} provider for "${languageId}" failed`, error);
    return undefined;
  }
}

type WatchedModel = {
  listener: monacoType.IDisposable;
  timer?: ReturnType<typeof setTimeout>;
  run?: { isCancellationRequested: boolean };
};

/**
 * Asks the provider for the diagnostics of each model of the language: shortly after it opens or changes to the
 * language, and after each pause in typing. A newer request cancels an older one, and only the answer for the
 * model's current text is shown.
 */
function watchDiagnostics(
  monaco: MonacoApi,
  languageId: string,
  owner: string,
  provider: DiagnosticsProvider,
  toDocument: (model: monacoType.editor.ITextModel) => TextDocument,
  delayMs: number
): monacoType.IDisposable {
  const watched = new Map<monacoType.editor.ITextModel, WatchedModel>();

  const cancel = (state: WatchedModel) => {
    clearTimeout(state.timer);
    state.timer = undefined;
    if (state.run) {
      state.run.isCancellationRequested = true;
      state.run = undefined;
    }
  };

  const check = (model: monacoType.editor.ITextModel, state: WatchedModel) => {
    cancel(state);
    const run = { isCancellationRequested: false };
    state.run = run;
    const version = model.getVersionId();
    const isStale = () => run.isCancellationRequested || watched.get(model) !== state || model.isDisposed() || model.getVersionId() !== version;
    void (async () => {
      try {
        const diagnostics = await provider.provideDiagnostics(toDocument(model), run as CancellationToken);
        return isStale() ? undefined : (diagnostics ?? []).map((diagnostic) => toMonacoMarker(monaco, diagnostic));
      }
      catch (error) {
        // A provider that gives up on cancellation isn't a failure
        if (!isStale()) {
          console.error(`[editorLanguages] A diagnostics provider for "${languageId}" failed`, error);
        }
        return undefined;
      }
    })().then((markers) => {
      if (isStale()) {
        return;
      }
      state.run = undefined;
      // A failed provider shows nothing rather than problems from older text
      monaco.editor.setModelMarkers(model, owner, markers ?? []);
    });
  };

  const schedule = (model: monacoType.editor.ITextModel, state: WatchedModel) => {
    cancel(state);
    state.timer = setTimeout(() => check(model, state), delayMs);
  };

  const watch = (model: monacoType.editor.ITextModel) => {
    if (watched.has(model) || model.getLanguageId() !== languageId) {
      return;
    }
    const state: WatchedModel = { listener: model.onDidChangeContent(() => schedule(model, state)) };
    watched.set(model, state);
    // Delayed also when it opens: the file is then in the files registry, for the document's fileId
    schedule(model, state);
  };

  const unwatch = (model: monacoType.editor.ITextModel) => {
    const state = watched.get(model);
    if (!state) {
      return;
    }
    watched.delete(model);
    cancel(state);
    state.listener.dispose();
    if (!model.isDisposed()) {
      monaco.editor.setModelMarkers(model, owner, []);
    }
  };

  const listeners = [
    monaco.editor.onDidCreateModel(watch),
    monaco.editor.onDidChangeModelLanguage(({ model }) => (model.getLanguageId() === languageId ? watch(model) : unwatch(model))),
    monaco.editor.onWillDisposeModel(unwatch)
  ];
  monaco.editor.getModels().forEach(watch);

  return {
    dispose: () => {
      listeners.forEach((listener) => listener.dispose());
      [...watched.keys()].forEach(unwatch);
    }
  };
}

function toMonacoMarker(monaco: MonacoApi, diagnostic: Diagnostic): monacoType.editor.IMarkerData {
  return {
    ...toMonacoRange(diagnostic.range),
    message: String(diagnostic.message),
    severity: toMonacoSeverity(monaco, diagnostic.severity),
    ...(diagnostic.source !== undefined ? { source: diagnostic.source } : {}),
    ...(diagnostic.code !== undefined ? { code: diagnostic.code } : {})
  };
}

function toMonacoSeverity(monaco: MonacoApi, severity: Diagnostic["severity"]): monacoType.MarkerSeverity {
  switch (severity) {
    case "warning":
      return monaco.MarkerSeverity.Warning;
    case "info":
      return monaco.MarkerSeverity.Info;
    case "hint":
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Error;
  }
}

function toTextDocument(model: monacoType.editor.ITextModel, fileId: string | undefined): TextDocument {
  return {
    uri: model.uri.toString(),
    languageId: model.getLanguageId(),
    ...(fileId ? { fileId } : {}),
    getText: (range?: TextRange) => (range ? model.getValueInRange(range) : model.getValue()),
    get lineCount() {
      return model.getLineCount();
    },
    lineAt: (lineNumber: number) => ({
      lineNumber,
      text: model.getLineContent(lineNumber),
      range: { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: model.getLineMaxColumn(lineNumber) }
    })
  };
}

function toMonacoRange(range: TextRange): monacoType.IRange {
  return {
    startLineNumber: range.startLineNumber,
    startColumn: range.startColumn,
    endLineNumber: range.endLineNumber,
    endColumn: range.endColumn
  };
}

/** Monaco's default for an item without a range: insert up to the cursor, or replace the whole word at it. */
function wordRanges(model: monacoType.editor.ITextModel, position: monacoType.Position): monacoType.languages.CompletionItemRanges {
  const until = model.getWordUntilPosition(position);
  const at = model.getWordAtPosition(position);
  return {
    insert: { startLineNumber: position.lineNumber, startColumn: until.startColumn, endLineNumber: position.lineNumber, endColumn: position.column },
    replace: {
      startLineNumber: position.lineNumber,
      startColumn: until.startColumn,
      endLineNumber: position.lineNumber,
      endColumn: Math.max(at?.endColumn ?? position.column, position.column)
    }
  };
}

/** The API's `CompletionItemKind` is numbered differently from Monaco's; the names are the same. */
function toMonacoKind(languages: MonacoLanguages, kind: CompletionItemKind): monacoType.languages.CompletionItemKind {
  // Only the API's numbers: a plain JS plugin's "Field" would otherwise map to Monaco's name, not its number
  const name = typeof kind === "number" ? (CompletionItemKind[kind] as keyof typeof monacoType.languages.CompletionItemKind | undefined) : undefined;
  const monacoKind = name ? languages.CompletionItemKind[name] : undefined;
  return monacoKind ?? languages.CompletionItemKind.Text;
}

function toMonacoCompletionItem(
  languages: MonacoLanguages,
  item: CompletionItem,
  defaultRange: monacoType.languages.CompletionItemRanges
): monacoType.languages.CompletionItem {
  return {
    label: item.label,
    kind: toMonacoKind(languages, item.kind),
    insertText: item.insertText ?? item.label,
    range: item.range ? toMonacoRange(item.range) : defaultRange,
    ...(item.insertTextFormat === "snippet" ? { insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
    ...(item.detail !== undefined ? { detail: item.detail } : {}),
    ...(item.documentation !== undefined ? { documentation: item.documentation } : {}),
    ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
    ...(item.filterText !== undefined ? { filterText: item.filterText } : {}),
    ...(item.preselect !== undefined ? { preselect: item.preselect } : {})
  };
}

export const editorLanguageFeatures = createEditorLanguageFeatureRegistrars();
