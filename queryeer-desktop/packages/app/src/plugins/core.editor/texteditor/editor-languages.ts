import type * as monacoType from "monaco-editor";
import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type { EditorLanguageDefinition } from "@queryeer/api/editor/EditorLanguageExtension";

type MonacoLanguages = Pick<
  typeof monacoType.languages,
  "register" | "getLanguages" | "setMonarchTokensProvider" | "setLanguageConfiguration"
>;

type LoadMonacoLanguages = () => Promise<MonacoLanguages>;

async function loadMonacoLanguages(): Promise<MonacoLanguages> {
  const monaco = await import("monaco-editor");
  return monaco.languages;
}

/**
 * Creates the backing implementation of `editorLanguages.registerLanguage`.
 *
 * Monaco cannot unregister a language, so disposing a registration removes its
 * tokenizer and configuration but keeps the id known to Monaco. The same id can be
 * registered again afterwards (e.g. when a plugin is reloaded).
 */
export function createEditorLanguageRegistrar(
  loadMonaco: LoadMonacoLanguages = loadMonacoLanguages
): (definition: EditorLanguageDefinition) => Disposable {
  const activeIds = new Set<string>();
  const idsRegisteredWithMonaco = new Set<string>();

  return (definition) => {
    const id = definition?.id?.trim();
    if (!id) {
      throw new Error("Editor language id must be non-empty");
    }
    if (!definition.monarch || typeof definition.monarch.tokenizer !== "object" || definition.monarch.tokenizer === null) {
      throw new Error(`Editor language "${id}" must define a Monarch tokenizer`);
    }
    if (activeIds.has(id)) {
      throw new Error(`Editor language "${id}" is already registered`);
    }
    activeIds.add(id);

    let disposed = false;
    const monacoDisposables: monacoType.IDisposable[] = [];

    void loadMonaco()
      .then((languages) => {
        if (disposed) {
          return;
        }
        if (!idsRegisteredWithMonaco.has(id)) {
          if (languages.getLanguages().some((language) => language.id === id)) {
            console.warn(`[editorLanguages] Language "${id}" is built into the editor and cannot be redefined`);
            return;
          }
          languages.register({ id, ...(definition.aliases ? { aliases: definition.aliases } : {}) });
          idsRegisteredWithMonaco.add(id);
        }
        monacoDisposables.push(
          languages.setMonarchTokensProvider(id, definition.monarch as monacoType.languages.IMonarchLanguage)
        );
        if (definition.configuration) {
          monacoDisposables.push(
            languages.setLanguageConfiguration(
              id,
              definition.configuration as monacoType.languages.LanguageConfiguration
            )
          );
        }
      })
      .catch((error: unknown) => {
        console.error(`[editorLanguages] Failed to register language "${id}"`, error);
      });

    return {
      dispose: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        activeIds.delete(id);
        for (const disposable of monacoDisposables.splice(0)) {
          disposable.dispose();
        }
      }
    };
  };
}

export const registerEditorLanguage = createEditorLanguageRegistrar();
