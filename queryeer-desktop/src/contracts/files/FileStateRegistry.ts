/**
 * A typed key used to namespace per-file state entries.
 * Create one with `defineStateKey` — the phantom `_type` field carries the value type
 * so the registry's `get`/`set` methods can infer `T` without a cast at the call site.
 */
export type StateKey<T> = {
  readonly id: string;
  readonly _type?: T;
};

export function defineStateKey<T>(id: string): StateKey<T> {
  return { id } as StateKey<T>;
}

/**
 * Per-file key/value store whose entries are automatically evicted (and disposed)
 * when the owning file is closed.
 *
 * Typical usage:
 *   const MY_KEY = defineStateKey<MyState>("my.plugin.key");
 *   registry.set(fileId, MY_KEY, value, (v) => v.stream.close());
 *   registry.get(fileId, MY_KEY);  // returns MyState | undefined
 */
export interface FileStateRegistry {
  get<T>(fileId: string, key: StateKey<T>): T | undefined;
  set<T>(fileId: string, key: StateKey<T>, value: T, dispose?: (value: T) => void): void;
  delete<T>(fileId: string, key: StateKey<T>): void;
  /** Called automatically by FilesRegistry when a file is closed. */
  evict(fileId: string): void;
}
