import type { Disposable } from "@queryeer/api/editor/EditorApi";

export type RefCountedList<T> = {
  /** Adds the items. Disposing releases this call's hold on each; an item leaves the list when no call holds it. */
  add: (items: T[]) => Disposable;
  /** The listed items, each key once, in the order first added. The same array instance on every call. */
  items: () => T[];
};

/**
 * A list where items with the same key are listed once (the first one added) and stay listed while any registration
 * that added an item with that key is still active. Used for when-expression templates and variables, which several
 * plugins may register identically.
 */
export function createRefCountedList<T>(keyOf: (item: T) => string): RefCountedList<T> {
  const listed: T[] = [];
  const holds = new Map<string, number>();

  const release = (key: string): void => {
    const count = (holds.get(key) ?? 0) - 1;
    if (count > 0) {
      holds.set(key, count);
      return;
    }
    holds.delete(key);
    const index = listed.findIndex((item) => keyOf(item) === key);
    if (index >= 0) listed.splice(index, 1);
  };

  return {
    add: (items) => {
      const keys: string[] = [];
      for (const item of items) {
        const key = keyOf(item);
        const count = holds.get(key) ?? 0;
        if (count === 0) listed.push(item);
        holds.set(key, count + 1);
        keys.push(key);
      }
      return {
        dispose: () => {
          for (const key of keys.splice(0)) release(key);
        }
      };
    },
    items: () => listed
  };
}
