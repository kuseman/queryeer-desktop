import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompletionItemKind,
  type CancellationToken,
  type CompletionProvider,
  type Diagnostic,
  type DiagnosticsProvider,
  type TextDocument
} from "@queryeer/api/editor/EditorApi";
import { createEditorLanguageFeatureRegistrars } from "./editor-language-features";

/** Monaco 0.56's numbering, which differs from the API's: Field is 3 in both, Keyword 17 against 12, Snippet 28 against 13. */
const MONACO_KINDS = { Method: 0, Field: 3, Keyword: 17, Text: 18, Snippet: 28 };
const MONACO_SEVERITY = { Hint: 1, Info: 2, Warning: 4, Error: 8 };

type Registered = { languageId: string; provider: Record<string, unknown>; disposable: { dispose: ReturnType<typeof vi.fn> } };

function createMonacoLanguagesMock() {
  const registered: Registered[] = [];
  const register = (languageId: string, provider: Record<string, unknown>) => {
    const disposable = { dispose: vi.fn() };
    registered.push({ languageId, provider, disposable });
    return disposable;
  };
  const languages = {
    registerCompletionItemProvider: vi.fn(register),
    registerHoverProvider: vi.fn(register),
    registerSignatureHelpProvider: vi.fn(register),
    CompletionItemKind: MONACO_KINDS,
    CompletionItemInsertTextRule: { None: 0, KeepWhitespace: 1, InsertAsSnippet: 4 }
  };
  return { languages, registered };
}

/** A Monaco text model with just what the adapters use. */
function model(lines: string[], uri = "file:///c%3A/work/orders.mongo") {
  return {
    uri: { toString: () => uri },
    getLanguageId: () => "mongodb",
    getValue: () => lines.join("\n"),
    getValueInRange: (range: { startLineNumber: number; startColumn: number; endColumn: number }) =>
      lines[range.startLineNumber - 1].slice(range.startColumn - 1, range.endColumn - 1),
    getLineCount: () => lines.length,
    getLineContent: (lineNumber: number) => lines[lineNumber - 1],
    getLineMaxColumn: (lineNumber: number) => lines[lineNumber - 1].length + 1,
    getWordUntilPosition: (position: { lineNumber: number; column: number }) => {
      const before = lines[position.lineNumber - 1].slice(0, position.column - 1);
      const word = /\w*$/.exec(before)?.[0] ?? "";
      return { word, startColumn: position.column - word.length, endColumn: position.column };
    },
    getWordAtPosition: (position: { lineNumber: number; column: number }) => {
      const line = lines[position.lineNumber - 1];
      const start = position.column - 1 - (/\w*$/.exec(line.slice(0, position.column - 1))?.[0].length ?? 0);
      const word = /^\w*/.exec(line.slice(start))?.[0] ?? "";
      return word ? { word, startColumn: start + 1, endColumn: start + 1 + word.length } : null;
    }
  };
}

const token = { isCancellationRequested: false };

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(resolveFileId: (uri: string) => string | undefined = () => "file-1") {
  const mock = createMonacoLanguagesMock();
  const registrars = createEditorLanguageFeatureRegistrars(
    async () => ({ languages: mock.languages, editor: {}, MarkerSeverity: MONACO_SEVERITY }) as never,
    resolveFileId
  );
  return { ...mock, registrars };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("editorLanguages.registerCompletionProvider", () => {
  it("hands the provider the open file and maps its items to Monaco's", async () => {
    const { registrars, registered } = setup();
    let seen: TextDocument | undefined;
    const provider: CompletionProvider = {
      triggerCharacters: ["."],
      provideCompletionItems: (document, position) => {
        seen = document;
        expect(position).toEqual({ lineNumber: 1, column: 7 });
        return {
          suggestions: [
            { label: "orders", kind: CompletionItemKind.Field, insertText: "orders", detail: "collection" },
            { label: "find", kind: CompletionItemKind.Keyword, insertText: "find()", range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 } }
          ],
          incomplete: true
        };
      }
    };

    registrars.registerCompletionProvider("mongodb", provider);
    await flush();

    expect(registered).toHaveLength(1);
    expect(registered[0].languageId).toBe("mongodb");
    expect(registered[0].provider.triggerCharacters).toEqual(["."]);
    const provide = registered[0].provider.provideCompletionItems as (...args: unknown[]) => Promise<unknown>;
    const result = await provide(model(["db.ord", "  .find()"]), { lineNumber: 1, column: 7 }, { triggerKind: 1, triggerCharacter: "." }, token);
    const wordBeforeCursor = { startLineNumber: 1, startColumn: 4, endLineNumber: 1, endColumn: 7 };

    expect(seen?.fileId).toBe("file-1");
    expect(seen?.uri).toBe("file:///c%3A/work/orders.mongo");
    expect(seen?.getText()).toBe("db.ord\n  .find()");
    expect(seen?.lineCount).toBe(2);
    expect(seen?.lineAt(2)).toEqual({ lineNumber: 2, text: "  .find()", range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 10 } });
    expect(result).toEqual({
      suggestions: [
        // No range: Monaco's default, the word before the cursor ("ord"), here also the whole word
        { label: "orders", kind: MONACO_KINDS.Field, insertText: "orders", detail: "collection", range: { insert: wordBeforeCursor, replace: wordBeforeCursor } },
        { label: "find", kind: MONACO_KINDS.Keyword, insertText: "find()", range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 3 } }
      ],
      incomplete: true
    });
  });

  it("leaves fileId out for a model that isn't an open file", async () => {
    const { registrars, registered } = setup(() => undefined);
    let seen: TextDocument | undefined;
    registrars.registerCompletionProvider("mongodb", {
      provideCompletionItems: (document) => {
        seen = document;
        return null;
      }
    });
    await flush();

    const provide = registered[0].provider.provideCompletionItems as (...args: unknown[]) => Promise<unknown>;
    expect(await provide(model(["db."]), { lineNumber: 1, column: 4 }, { triggerKind: 0 }, token)).toEqual({ suggestions: [] });
    expect(seen).toBeDefined();
    expect(seen && "fileId" in seen).toBe(false);
  });

  it("offers nothing when the provider throws or rejects, and logs it", async () => {
    const { registrars, registered } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    registrars.registerCompletionProvider("mongodb", { provideCompletionItems: () => { throw new Error("boom"); } });
    registrars.registerCompletionProvider("mongodb", { provideCompletionItems: () => Promise.reject(new Error("later")) });
    await flush();

    for (const entry of registered) {
      const provide = entry.provider.provideCompletionItems as (...args: unknown[]) => Promise<unknown>;
      expect(await provide(model(["db."]), { lineNumber: 1, column: 4 }, { triggerKind: 0 }, token)).toEqual({ suggestions: [] });
    }
    expect(error).toHaveBeenCalledTimes(2);
  });

  it("removes the provider on dispose, and never registers one disposed before Monaco loaded", async () => {
    const { registrars, registered } = setup();

    const early = registrars.registerCompletionProvider("mongodb", { provideCompletionItems: () => null });
    early.dispose();
    const later = registrars.registerCompletionProvider("mongodb", { provideCompletionItems: () => null });
    await flush();

    expect(registered).toHaveLength(1);
    later.dispose();
    later.dispose();
    expect(registered[0].disposable.dispose).toHaveBeenCalledTimes(1);
  });

  it("replaces the rest of the word after the cursor in replace mode, and inserts snippets as snippets", async () => {
    const { registrars, registered } = setup();
    registrars.registerCompletionProvider("mongodb", {
      provideCompletionItems: () => ({
        suggestions: [
          { label: "orders", kind: CompletionItemKind.Field, insertText: "orders" },
          { label: "find", kind: CompletionItemKind.Snippet, insertText: "find(${1:filter})", insertTextFormat: "snippet" }
        ]
      })
    });
    await flush();

    const provide = registered[0].provider.provideCompletionItems as (...args: unknown[]) => Promise<{ suggestions: Record<string, unknown>[] }>;
    // The cursor inside "ordxx": "ord" before it, "xx" after
    const { suggestions } = await provide(model(["db.ordxx"]), { lineNumber: 1, column: 7 }, { triggerKind: 0 }, token);

    expect(suggestions[0].range).toEqual({
      insert: { startLineNumber: 1, startColumn: 4, endLineNumber: 1, endColumn: 7 },
      replace: { startLineNumber: 1, startColumn: 4, endLineNumber: 1, endColumn: 9 }
    });
    expect(suggestions[0].insertTextRules).toBeUndefined();
    expect(suggestions[1]).toMatchObject({ kind: MONACO_KINDS.Snippet, insertText: "find(${1:filter})", insertTextRules: 4 });
  });

  it("maps only the API's kind numbers, and anything else to Text", async () => {
    const { registrars, registered } = setup();
    registrars.registerCompletionProvider("mongodb", {
      provideCompletionItems: () => ({
        // A plain JS plugin's mistakes
        suggestions: [{ label: "a", kind: "Field" as never, insertText: "a" }, { label: "b", kind: 99 as never, insertText: "b" }]
      })
    });
    await flush();

    const provide = registered[0].provider.provideCompletionItems as (...args: unknown[]) => Promise<{ suggestions: { kind: unknown }[] }>;
    const { suggestions } = await provide(model(["db."]), { lineNumber: 1, column: 4 }, { triggerKind: 0 }, token);
    expect(suggestions.map((item) => item.kind)).toEqual([MONACO_KINDS.Text, MONACO_KINDS.Text]);
  });

  it("offers nothing for a result it can't map, or one that arrives after cancellation, and logs only the first", async () => {
    const { registrars, registered } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    registrars.registerCompletionProvider("mongodb", { provideCompletionItems: () => ({ suggestions: [null as never] }) });
    registrars.registerCompletionProvider("mongodb", { provideCompletionItems: () => ({ suggestions: [{ label: "a", kind: CompletionItemKind.Text, insertText: "a" }] }) });
    await flush();

    const malformed = registered[0].provider.provideCompletionItems as (...args: unknown[]) => Promise<unknown>;
    const late = registered[1].provider.provideCompletionItems as (...args: unknown[]) => Promise<unknown>;
    expect(await malformed(model(["db."]), { lineNumber: 1, column: 4 }, { triggerKind: 0 }, token)).toEqual({ suggestions: [] });
    expect(await late(model(["db."]), { lineNumber: 1, column: 4 }, { triggerKind: 0 }, { isCancellationRequested: true })).toEqual({ suggestions: [] });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('[editorLanguages] A completion provider for "mongodb" failed');
  });

  it("logs a Monaco that fails to load, and disposing is then harmless", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const registrars = createEditorLanguageFeatureRegistrars(() => Promise.reject(new Error("no monaco")), () => undefined);

    const registration = registrars.registerHoverProvider("mongodb", { provideHover: () => null });
    await flush();

    expect(error).toHaveBeenCalledTimes(1);
    expect(() => registration.dispose()).not.toThrow();
  });

  it("rejects a blank language id and a provider without its method", () => {
    const { registrars } = setup();

    expect(() => registrars.registerCompletionProvider(" ", { provideCompletionItems: () => null })).toThrow("must be non-empty");
    expect(() => registrars.registerCompletionProvider("mongodb", {} as CompletionProvider)).toThrow("must have a provideCompletionItems method");
    expect(() => registrars.registerHoverProvider("mongodb", null as never)).toThrow("must have a provideHover method");
  });
});

describe("editorLanguages.registerHoverProvider", () => {
  it("maps the hover, and shows none for an empty one", async () => {
    const { registrars, registered } = setup();
    registrars.registerHoverProvider("mongodb", {
      provideHover: (_document, position) =>
        position.column === 1
          ? { contents: [] }
          : { range: { startLineNumber: 1, startColumn: 20, endLineNumber: 1, endColumn: 23 }, contents: [{ value: "**$lt** less than" }] }
    });
    await flush();

    const provide = registered[0].provider.provideHover as (...args: unknown[]) => Promise<unknown>;
    expect(await provide(model(["db.orders.find({ a: { $lt: 2 } })"]), { lineNumber: 1, column: 21 }, token)).toEqual({
      range: { startLineNumber: 1, startColumn: 20, endLineNumber: 1, endColumn: 23 },
      // Not trusted unless the provider says so
      contents: [{ value: "**$lt** less than", isTrusted: false }]
    });
    expect(await provide(model(["db"]), { lineNumber: 1, column: 1 }, token)).toBeNull();
  });

  it("passes a trusted hover on, and leaves the range to Monaco when there is none", async () => {
    const { registrars, registered } = setup();
    registrars.registerHoverProvider("mongodb", { provideHover: () => ({ contents: [{ value: "[Run](command:x)", isTrusted: true }] }) });
    await flush();

    const provide = registered[0].provider.provideHover as (...args: unknown[]) => Promise<unknown>;
    expect(await provide(model(["db"]), { lineNumber: 1, column: 2 }, token)).toEqual({ contents: [{ value: "[Run](command:x)", isTrusted: true }] });
  });
});

describe("editorLanguages.registerSignatureHelpProvider", () => {
  it("maps signatures and parameters", async () => {
    const { registrars, registered } = setup();
    registrars.registerSignatureHelpProvider("mongodb", {
      signatureHelpTriggerCharacters: ["(", ","],
      provideSignatureHelp: () => ({
        activeSignature: 0,
        activeParameter: 1,
        signatures: [{ label: "find(filter, projection)", documentation: "Finds documents", parameters: [{ label: "filter" }, { label: "projection", documentation: "Fields to return" }] }]
      })
    });
    await flush();

    expect(registered[0].provider.signatureHelpTriggerCharacters).toEqual(["(", ","]);
    const provide = registered[0].provider.provideSignatureHelp as (...args: unknown[]) => Promise<{ value: unknown; dispose: () => void } | null>;
    const result = await provide(model(["db.orders.find({}, "]), { lineNumber: 1, column: 20 }, token, {});
    expect(result?.value).toEqual({
      activeSignature: 0,
      activeParameter: 1,
      signatures: [{
        label: "find(filter, projection)",
        documentation: "Finds documents",
        parameters: [{ label: "filter", documentation: undefined }, { label: "projection", documentation: "Fields to return" }]
      }]
    });
    expect(() => result?.dispose()).not.toThrow();
  });

  it("shows none without signatures, and a signature without parameters", async () => {
    const { registrars, registered } = setup();
    registrars.registerSignatureHelpProvider("mongodb", {
      provideSignatureHelp: (_document, position) =>
        position.column === 1
          ? { activeSignature: 0, activeParameter: 0, signatures: [] }
          : { activeSignature: 0, activeParameter: 0, signatures: [{ label: "count()" }] }
    });
    await flush();

    const provide = registered[0].provider.provideSignatureHelp as (...args: unknown[]) => Promise<{ value: { signatures: unknown[] } } | null>;
    expect(await provide(model(["db.a.count("]), { lineNumber: 1, column: 1 }, token, {})).toBeNull();
    expect((await provide(model(["db.a.count("]), { lineNumber: 1, column: 12 }, token, {}))?.value.signatures).toEqual([
      { label: "count()", documentation: undefined, parameters: [] }
    ]);
  });
});

/** A Monaco model whose text, language and life can change, as the diagnostics watcher sees it. */
function liveModel(text: string, languageId = "mongodb", uri = "file:///c%3A/work/orders.mongo") {
  const contentListeners = new Set<() => void>();
  const state = { text, languageId, version: 1, disposed: false };
  const live = {
    ...model([text], uri),
    getValue: () => state.text,
    getLanguageId: () => state.languageId,
    getVersionId: () => state.version,
    isDisposed: () => state.disposed,
    onDidChangeContent: (listener: () => void) => {
      contentListeners.add(listener);
      return { dispose: () => contentListeners.delete(listener) };
    },
    type(newText: string) {
      state.text = newText;
      state.version++;
      contentListeners.forEach((listener) => listener());
    },
    state,
    contentListeners
  };
  return live;
}

type LiveModel = ReturnType<typeof liveModel>;

function createMonacoEditorMock(initial: LiveModel[] = []) {
  const models = [...initial];
  const created = new Set<(model: LiveModel) => void>();
  const languageChanged = new Set<(event: { model: LiveModel }) => void>();
  const willDispose = new Set<(model: LiveModel) => void>();
  const subscribe = <T>(listeners: Set<T>) => (listener: T) => {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  };
  /** The markers each owner last set on each model. */
  const markers = new Map<LiveModel, Map<string, unknown[]>>();
  const editor = {
    getModels: () => models,
    onDidCreateModel: subscribe(created),
    onDidChangeModelLanguage: subscribe(languageChanged),
    onWillDisposeModel: subscribe(willDispose),
    setModelMarkers: vi.fn((model: LiveModel, owner: string, data: unknown[]) => {
      if (!markers.has(model)) {
        markers.set(model, new Map());
      }
      markers.get(model)?.set(owner, data);
    })
  };
  return {
    editor,
    markers,
    open(model: LiveModel) {
      models.push(model);
      created.forEach((listener) => listener(model));
    },
    changeLanguage(model: LiveModel, languageId: string) {
      model.state.languageId = languageId;
      languageChanged.forEach((listener) => listener({ model }));
    },
    close(model: LiveModel) {
      willDispose.forEach((listener) => listener(model));
      model.state.disposed = true;
      models.splice(models.indexOf(model), 1);
    }
  };
}

const DELAY = 500;

function setupDiagnostics(initial: LiveModel[] = []) {
  const monaco = createMonacoEditorMock(initial);
  const { languages } = createMonacoLanguagesMock();
  const registrars = createEditorLanguageFeatureRegistrars(
    async () => ({ languages, editor: monaco.editor, MarkerSeverity: MONACO_SEVERITY }) as never,
    () => "file-1",
    DELAY
  );
  return { ...monaco, registrars };
}

/** Each "error" in the text is a problem. */
function findErrors(document: TextDocument): Diagnostic[] {
  return [...document.getText().matchAll(/error/g)].map((match) => ({
    range: { startLineNumber: 1, startColumn: match.index + 1, endLineNumber: 1, endColumn: match.index + 6 },
    message: "an error"
  }));
}

const errorFinder: DiagnosticsProvider = { provideDiagnostics: findErrors };

function markerColumns(markers: Map<LiveModel, Map<string, unknown[]>>, model: LiveModel): number[][] {
  return [...(markers.get(model)?.values() ?? [])].map((list) => (list as { startColumn: number }[]).map((marker) => marker.startColumn));
}

describe("editorLanguages.registerDiagnosticsProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks open documents of the language and new ones, and again after a pause in typing", async () => {
    vi.useFakeTimers();
    const open = liveModel("error here");
    const sql = liveModel("error", "sql", "file:///c%3A/work/a.sql");
    const { registrars, markers, open: openModel } = setupDiagnostics([open, sql]);
    const provider = { provideDiagnostics: vi.fn(errorFinder.provideDiagnostics) };

    registrars.registerDiagnosticsProvider("mongodb", provider);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, open)).toEqual([[1]]);
    expect(markers.has(sql)).toBe(false);
    expect(provider.provideDiagnostics.mock.calls[0][0]).toMatchObject({ fileId: "file-1", languageId: "mongodb" });

    const opened = liveModel("no problem, error", "mongodb", "file:///c%3A/work/b.mongo");
    openModel(opened);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, opened)).toEqual([[13]]);

    open.type("e");
    open.type("er");
    open.type("fine, then error");
    await vi.advanceTimersByTimeAsync(DELAY - 1);
    expect(markerColumns(markers, open)).toEqual([[1]]);
    await vi.advanceTimersByTimeAsync(1);
    expect(markerColumns(markers, open)).toEqual([[12]]);
    // Once per pause, not per keystroke: the two opens and the edit
    expect(provider.provideDiagnostics).toHaveBeenCalledTimes(3);
  });

  it("maps severity, source and code, with error as the default", async () => {
    vi.useFakeTimers();
    const open = liveModel("x");
    const { registrars, markers } = setupDiagnostics([open]);
    const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 };
    registrars.registerDiagnosticsProvider("mongodb", {
      provideDiagnostics: () => [
        { range, message: "e" },
        { range, message: "w", severity: "warning", source: "mongodb", code: "M1" },
        { range, message: "i", severity: "info" },
        { range, message: "h", severity: "hint" },
        { range, message: "typo", severity: "warn" as never }
      ]
    });
    await vi.advanceTimersByTimeAsync(DELAY);

    expect([...(markers.get(open)?.values() ?? [])][0]).toEqual([
      { ...range, message: "e", severity: MONACO_SEVERITY.Error },
      { ...range, message: "w", severity: MONACO_SEVERITY.Warning, source: "mongodb", code: "M1" },
      { ...range, message: "i", severity: MONACO_SEVERITY.Info },
      { ...range, message: "h", severity: MONACO_SEVERITY.Hint },
      { ...range, message: "typo", severity: MONACO_SEVERITY.Error }
    ]);
  });

  it("drops an answer for older text, and cancels the request it replaces", async () => {
    vi.useFakeTimers();
    const open = liveModel("error");
    const { registrars, markers } = setupDiagnostics([open]);
    const tokens: CancellationToken[] = [];
    registrars.registerDiagnosticsProvider("mongodb", {
      provideDiagnostics: async (document, token) => {
        tokens.push(token);
        const text = document.getText();
        if (tokens.length === 1) {
          // The first request is slow
          await new Promise((resolve) => setTimeout(resolve, 2 * DELAY));
        }
        return findErrors({ ...document, getText: () => text });
      }
    });
    await vi.advanceTimersByTimeAsync(DELAY);
    open.type("ok, error");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(tokens[0].isCancellationRequested).toBe(true);
    expect(markerColumns(markers, open)).toEqual([[5]]);

    // The slow answer about "error" arrives, and is ignored
    await vi.advanceTimersByTimeAsync(2 * DELAY);
    expect(markerColumns(markers, open)).toEqual([[5]]);
  });

  it("keeps each provider's markers apart, and disposing removes only its own", async () => {
    vi.useFakeTimers();
    const open = liveModel("error");
    const { registrars, markers } = setupDiagnostics([open]);
    const first = registrars.registerDiagnosticsProvider("mongodb", errorFinder);
    registrars.registerDiagnosticsProvider("mongodb", errorFinder);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, open)).toEqual([[1], [1]]);

    first.dispose();
    expect(markerColumns(markers, open)).toEqual([[], [1]]);

    // No longer asked
    open.type("error error");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, open)).toEqual([[], [1, 7]]);
  });

  it("clears the markers when a document changes to another language, and checks one that changes to it", async () => {
    vi.useFakeTimers();
    const open = liveModel("error");
    const other = liveModel("error", "plaintext", "file:///c%3A/work/c.txt");
    const { registrars, markers, changeLanguage } = setupDiagnostics([open, other]);
    registrars.registerDiagnosticsProvider("mongodb", errorFinder);
    await vi.advanceTimersByTimeAsync(DELAY);

    changeLanguage(open, "plaintext");
    changeLanguage(other, "mongodb");
    expect(markerColumns(markers, open)).toEqual([[]]);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, other)).toEqual([[1]]);
    expect(open.contentListeners.size).toBe(0);
  });

  it("stops watching a closed document", async () => {
    vi.useFakeTimers();
    const open = liveModel("error");
    const { registrars, markers, close } = setupDiagnostics([open]);
    const provider = { provideDiagnostics: vi.fn(errorFinder.provideDiagnostics) };
    registrars.registerDiagnosticsProvider("mongodb", provider);
    // Monaco loaded, the check pending
    await vi.advanceTimersByTimeAsync(0);
    expect(open.contentListeners.size).toBe(1);
    open.type("error error");

    close(open);
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(provider.provideDiagnostics).not.toHaveBeenCalled();
    expect(markerColumns(markers, open)).toEqual([[]]);
    expect(open.contentListeners.size).toBe(0);
  });

  it("sets nothing for an answer that arrives after the registration is disposed, and doesn't log a provider that gives up on cancellation", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const open = liveModel("error");
    const { registrars, editor } = setupDiagnostics([open]);
    const registration = registrars.registerDiagnosticsProvider("mongodb", {
      provideDiagnostics: async (document, token) => {
        await new Promise((resolve) => setTimeout(resolve, DELAY));
        if (token.isCancellationRequested) {
          throw new Error("cancelled");
        }
        return findErrors(document);
      }
    });
    await vi.advanceTimersByTimeAsync(DELAY);

    registration.dispose();
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(editor.setModelMarkers.mock.calls.map((call) => call[2])).toEqual([[]]);
    expect(error).not.toHaveBeenCalled();
  });

  it("registers nothing when disposed before Monaco has loaded", async () => {
    vi.useFakeTimers();
    const open = liveModel("error");
    const { registrars, editor } = setupDiagnostics([open]);
    registrars.registerDiagnosticsProvider("mongodb", errorFinder).dispose();

    await vi.advanceTimersByTimeAsync(DELAY);
    expect(editor.setModelMarkers).not.toHaveBeenCalled();
    expect(open.contentListeners.size).toBe(0);
  });

  it("trims the language id", async () => {
    vi.useFakeTimers();
    const open = liveModel("error");
    const { registrars, markers } = setupDiagnostics([open]);
    registrars.registerDiagnosticsProvider(" mongodb ", errorFinder);

    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, open)).toEqual([[1]]);
  });

  it("shows nothing for a provider that fails, rather than older problems, and logs it", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const open = liveModel("error");
    const { registrars, markers } = setupDiagnostics([open]);
    registrars.registerDiagnosticsProvider("mongodb", {
      provideDiagnostics: (document) => {
        if (document.getText() === "broken") {
          throw new Error("parser crashed");
        }
        return findErrors(document);
      }
    });
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, open)).toEqual([[1]]);

    open.type("broken");
    await vi.advanceTimersByTimeAsync(DELAY);
    expect(markerColumns(markers, open)).toEqual([[]]);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('[editorLanguages] A diagnostics provider for "mongodb" failed');
  });

  it("rejects a provider without provideDiagnostics", () => {
    const { registrars } = setupDiagnostics();
    expect(() => registrars.registerDiagnosticsProvider("mongodb", {} as DiagnosticsProvider)).toThrow("must have a provideDiagnostics method");
  });
});
