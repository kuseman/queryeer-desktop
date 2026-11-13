import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type { QueryEditorHeaderItemContribution } from "@queryeer/api/queryengine/QueryEditorHeaderExtension";

const items = new Map<string, QueryEditorHeaderItemContribution>();
const listeners = new Set<() => void>();
let snapshot: QueryEditorHeaderItemContribution[] = [];

export function registerQueryEditorHeaderItem(item: QueryEditorHeaderItemContribution): Disposable {
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

export function getQueryEditorHeaderItems(): QueryEditorHeaderItemContribution[] {
  return snapshot;
}

export function subscribeQueryEditorHeaderItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitChanged(): void {
  snapshot = [...items.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  for (const listener of listeners) {
    listener();
  }
}
