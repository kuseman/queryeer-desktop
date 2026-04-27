import type { FileStateRegistry, StateKey } from "../../contracts/files/FileStateRegistry";

type Entry = {
  value: unknown;
  dispose?: (value: unknown) => void;
};

class FileStateRegistryImpl implements FileStateRegistry {
  private readonly store = new Map<string, Map<string, Entry>>();

  get<T>(fileId: string, key: StateKey<T>): T | undefined {
    return this.store.get(fileId)?.get(key.id)?.value as T | undefined;
  }

  set<T>(fileId: string, key: StateKey<T>, value: T, dispose?: (value: T) => void): void {
    let bag = this.store.get(fileId);
    if (!bag) {
      bag = new Map();
      this.store.set(fileId, bag);
    }
    const existing = bag.get(key.id);
    if (existing?.dispose) existing.dispose(existing.value);
    bag.set(key.id, {
      value,
      dispose: dispose ? (v) => dispose(v as T) : undefined
    });
  }

  delete<T>(fileId: string, key: StateKey<T>): void {
    const bag = this.store.get(fileId);
    if (!bag) return;
    const existing = bag.get(key.id);
    if (existing?.dispose) existing.dispose(existing.value);
    bag.delete(key.id);
    if (bag.size === 0) this.store.delete(fileId);
  }

  evict(fileId: string): void {
    const bag = this.store.get(fileId);
    if (!bag) return;
    for (const entry of bag.values()) {
      entry.dispose?.(entry.value);
    }
    this.store.delete(fileId);
  }
}

const instance = new FileStateRegistryImpl();

export function getFileStateRegistry(): FileStateRegistry {
  return instance;
}
