import { describe, expect, it, vi } from "vitest";
import type { EditorLanguageDefinition } from "@queryeer/api/editor/EditorLanguageExtension";
import { createEditorLanguageRegistrar } from "./editor-languages";

function createMonacoLanguagesMock(builtinIds: string[] = ["json", "javascript"]) {
  const registered = builtinIds.map((id) => ({ id }));
  const tokenDisposables: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const configDisposables: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const languages = {
    register: vi.fn((language: { id: string }) => {
      registered.push(language);
    }),
    getLanguages: vi.fn(() => registered),
    setMonarchTokensProvider: vi.fn(() => {
      const disposable = { dispose: vi.fn() };
      tokenDisposables.push(disposable);
      return disposable;
    }),
    setLanguageConfiguration: vi.fn(() => {
      const disposable = { dispose: vi.fn() };
      configDisposables.push(disposable);
      return disposable;
    })
  };
  return { languages, tokenDisposables, configDisposables };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const MONGODB: EditorLanguageDefinition = {
  id: "mongodb",
  aliases: ["MongoDB"],
  monarch: { tokenizer: { root: [[/db\b/, "keyword"]] } },
  configuration: {
    comments: { lineComment: "//", blockComment: ["/*", "*/"] },
    brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
    autoClosingPairs: [{ open: "{", close: "}" }]
  }
};

describe("editorLanguages.registerLanguage", () => {
  it("registers the language with its tokenizer and configuration", async () => {
    const mock = createMonacoLanguagesMock();
    const register = createEditorLanguageRegistrar(async () => mock.languages as never);

    register(MONGODB);
    await flush();

    expect(mock.languages.register).toHaveBeenCalledWith({ id: "mongodb", aliases: ["MongoDB"] });
    expect(mock.languages.setMonarchTokensProvider).toHaveBeenCalledWith("mongodb", MONGODB.monarch);
    expect(mock.languages.setLanguageConfiguration).toHaveBeenCalledWith("mongodb", MONGODB.configuration);
  });

  it("removes the tokenizer and configuration on dispose and allows re-registration", async () => {
    const mock = createMonacoLanguagesMock();
    const register = createEditorLanguageRegistrar(async () => mock.languages as never);

    const first = register(MONGODB);
    await flush();
    first.dispose();

    expect(mock.tokenDisposables[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(mock.configDisposables[0]?.dispose).toHaveBeenCalledTimes(1);

    register(MONGODB);
    await flush();

    // Monaco cannot unregister a language id, so it is registered only once.
    expect(mock.languages.register).toHaveBeenCalledTimes(1);
    expect(mock.languages.setMonarchTokensProvider).toHaveBeenCalledTimes(2);
  });

  it("does nothing in Monaco when disposed before Monaco has loaded", async () => {
    const mock = createMonacoLanguagesMock();
    const register = createEditorLanguageRegistrar(async () => mock.languages as never);

    register(MONGODB).dispose();
    await flush();

    expect(mock.languages.register).not.toHaveBeenCalled();
    expect(mock.languages.setMonarchTokensProvider).not.toHaveBeenCalled();
  });

  it("rejects duplicate, blank and tokenizer-less registrations", () => {
    const mock = createMonacoLanguagesMock();
    const register = createEditorLanguageRegistrar(async () => mock.languages as never);

    register(MONGODB);
    expect(() => register(MONGODB)).toThrow("already registered");
    expect(() => register({ ...MONGODB, id: " " })).toThrow("non-empty");
    expect(() => register({ id: "x", monarch: {} as never })).toThrow("Monarch tokenizer");
  });

  it("refuses to redefine a built-in Monaco language", async () => {
    const mock = createMonacoLanguagesMock(["json"]);
    const register = createEditorLanguageRegistrar(async () => mock.languages as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    register({ ...MONGODB, id: "json" });
    await flush();

    expect(mock.languages.register).not.toHaveBeenCalled();
    expect(mock.languages.setMonarchTokensProvider).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("\"json\""));
    warn.mockRestore();
  });
});
