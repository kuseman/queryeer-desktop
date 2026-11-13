import type { QueryEditorStatusItemContribution } from "@queryeer/api/queryengine/QueryEditorStatusExtension";
import type { Disposable } from "@queryeer/api/editor/EditorApi";

const items = new Map<string, QueryEditorStatusItemContribution>();
const listeners = new Set<() => void>();
let snapshot: QueryEditorStatusItemContribution[] = [];

export function registerQueryEditorStatusItem(item: QueryEditorStatusItemContribution): Disposable {
  items.set(item.id, item);
  emitChanged();
  return {
    dispose: () => {
      if (items.get(item.id) !== item) {
        return;
      }
      items.delete(item.id);
      emitChanged();
    }
  };
}

export function getQueryEditorStatusItems(): QueryEditorStatusItemContribution[] {
  return snapshot;
}

export function subscribeQueryEditorStatusItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChanged(): void {
  snapshot = [...items.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const listener of listeners) {
    listener();
  }
}
