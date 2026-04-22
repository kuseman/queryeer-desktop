import type { ContextValues } from "./when-evaluator";

export type ContextKeyService = {
  get: (key: string) => string | number | boolean | undefined;
  set: (key: string, value: string | number | boolean | undefined) => void;
  snapshot: () => ContextValues;
  dispose: () => void;
};

function isInputLike(element: HTMLElement | null): boolean {
  if (!element) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  const tag = element.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function hasClosest(element: HTMLElement | null, selectors: string[]): boolean {
  if (!element) {
    return false;
  }
  return selectors.some((selector) => Boolean(element.closest(selector)));
}

export function createContextKeyService(documentRef: Document = document): ContextKeyService {
  const values = new Map<string, string | number | boolean | undefined>([
    ["global", true],
    ["editorFocus", false],
    ["terminalFocus", false],
    ["explorerFocus", false],
    ["inputFocus", false]
  ]);

  const refreshFocusContext = () => {
    const active = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
    values.set("inputFocus", isInputLike(active));
    values.set(
      "editorFocus",
      hasClosest(active, ["[data-context='editor']", ".shell-editor-pane", ".shell-editor-content"])
    );
    values.set("terminalFocus", hasClosest(active, ["[data-context='terminal']", ".terminal", ".xterm"]));
    values.set(
      "explorerFocus",
      hasClosest(active, ["[data-context='explorer']", ".shell-sidebar-primary"])
    );
  };

  const onFocusIn = () => refreshFocusContext();
  const onFocusOut = () => {
    window.setTimeout(refreshFocusContext, 0);
  };

  documentRef.addEventListener("focusin", onFocusIn);
  documentRef.addEventListener("focusout", onFocusOut);
  refreshFocusContext();

  return {
    get: (key) => values.get(key),
    set: (key, value) => {
      values.set(key, value);
    },
    snapshot: () => {
      const snapshot: ContextValues = {};
      for (const [key, value] of values.entries()) {
        snapshot[key] = value;
      }
      return snapshot;
    },
    dispose: () => {
      documentRef.removeEventListener("focusin", onFocusIn);
      documentRef.removeEventListener("focusout", onFocusOut);
    }
  };
}
