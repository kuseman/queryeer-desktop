import type { Disposable } from "@queryeer/api/editor/EditorApi";

/** A `Disposable` that runs `dispose` on the first call only. */
export function toDisposable(dispose: () => void): Disposable {
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      dispose();
    }
  };
}

/** Which registration owns each key of a map that `setDisposable` writes to. */
const owners = new WeakMap<Map<unknown, unknown>, Map<unknown, object>>();

/**
 * Sets `map[key] = value`. Disposing deletes the key, unless a later registration replaced it: a contribution
 * registered again under the same id belongs to that later registration, even when it is the same object.
 * `onRemoved` runs only when disposing actually removed the entry.
 */
export function setDisposable<K, V>(map: Map<K, V>, key: K, value: V, onRemoved?: () => void): Disposable {
  let keyOwners = owners.get(map as Map<unknown, unknown>);
  if (!keyOwners) {
    keyOwners = new Map();
    owners.set(map as Map<unknown, unknown>, keyOwners);
  }
  const token = {};
  map.set(key, value);
  keyOwners.set(key, token);
  return toDisposable(() => {
    // Also skipped when the key was since written directly, not through setDisposable
    if (keyOwners.get(key) !== token || map.get(key) !== value) {
      return;
    }
    keyOwners.delete(key);
    map.delete(key);
    onRemoved?.();
  });
}

/** Appends `value` to `list`. Disposing removes that entry. */
export function pushDisposable<T>(list: T[], value: T): Disposable {
  list.push(value);
  return toDisposable(() => {
    const index = list.indexOf(value);
    if (index >= 0) {
      list.splice(index, 1);
    }
  });
}

/** For a React effect: `useEffect(() => disposeOnCleanup(registry.subscribe(...)), deps)`. */
export function disposeOnCleanup(disposable: Disposable): () => void {
  return () => disposable.dispose();
}
