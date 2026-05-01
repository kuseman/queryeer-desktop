import type { ContextValues } from "./when-evaluator";
import type { ContextChain } from "./context-chain";
import { ContextPriority } from "./context-priority";

export type ContextKeyService = {
  get: (key: string) => string | number | boolean | undefined;
  set: (key: string, value: string | number | boolean | undefined) => void;
  snapshot: () => ContextValues;
  onDidChange: (listener: () => void) => () => void;
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

/**
 * Registers a ZONE-priority context scope into the chain and keeps it updated
 * via document focus events. Returns a dispose handle to remove DOM listeners
 * and unregister the scope.
 */
export function createZoneFocusScope(
  chain: ContextChain,
  documentRef: Document = document
): { dispose: () => void } {
  const SCOPE_ID = "core.commands.zone";

  const buildContext = (): ContextValues => {
    const active =
      documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
    return {
      global: true,
      inputFocus: isInputLike(active),
      editorFocus: hasClosest(active, [
        "[data-context='editor']",
        ".shell-editor-pane",
        ".shell-editor-content"
      ]),
      terminalFocus: hasClosest(active, ["[data-context='terminal']", ".terminal", ".xterm"]),
      explorerFocus: hasClosest(active, [
        "[data-context='explorer']",
        ".shell-sidebar-primary"
      ])
    };
  };

  const unregister = chain.register({
    id: SCOPE_ID,
    priority: ContextPriority.ZONE,
    context: buildContext()
  });

  const refresh = (): void => chain.update(SCOPE_ID, buildContext());
  const onFocusIn = (): void => refresh();
  const onFocusOut = (): void => {
    window.setTimeout(refresh, 0);
  };

  documentRef.addEventListener("focusin", onFocusIn);
  documentRef.addEventListener("focusout", onFocusOut);

  return {
    dispose: () => {
      documentRef.removeEventListener("focusin", onFocusIn);
      documentRef.removeEventListener("focusout", onFocusOut);
      unregister();
    }
  };
}

export function createContextKeyService(documentRef: Document = document): ContextKeyService {
  const values = new Map<string, string | number | boolean | undefined>([
    ["global", true],
    ["editorFocus", false],
    ["terminalFocus", false],
    ["explorerFocus", false],
    ["inputFocus", false]
  ]);
  const listeners = new Set<() => void>();

  const notifyChanged = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const update = (key: string, value: string | number | boolean | undefined) => {
    if (values.get(key) === value) {
      return;
    }
    values.set(key, value);
    notifyChanged();
  };

  const refreshFocusContext = () => {
    const active = documentRef.activeElement instanceof HTMLElement ? documentRef.activeElement : null;
    update("inputFocus", isInputLike(active));
    update(
      "editorFocus",
      hasClosest(active, ["[data-context='editor']", ".shell-editor-pane", ".shell-editor-content"])
    );
    update("terminalFocus", hasClosest(active, ["[data-context='terminal']", ".terminal", ".xterm"]));
    update(
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
      update(key, value);
    },
    snapshot: () => {
      const snapshot: ContextValues = {};
      for (const [key, value] of values.entries()) {
        snapshot[key] = value;
      }
      return snapshot;
    },
    onDidChange: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      documentRef.removeEventListener("focusin", onFocusIn);
      documentRef.removeEventListener("focusout", onFocusOut);
    }
  };
}
