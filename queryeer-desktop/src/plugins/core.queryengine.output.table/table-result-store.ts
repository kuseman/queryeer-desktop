export type TableResultStoreKey = {
  fileId?: string;
  resultSetIndex: number;
};

type Entry = {
  chunks: unknown[][][];
  rowCount: number;
  listeners: Set<() => void>;
};

class TableResultStore {
  private readonly entries = new Map<string, Entry>();

  clearFile(fileId?: string): void {
    const prefix = `${fileId ?? ""}:`;
    for (const [key, entry] of this.entries.entries()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      entry.chunks = [];
      entry.rowCount = 0;
      this.emit(entry);
    }
  }

  appendRows(key: TableResultStoreKey, rows: unknown[][]): void {
    if (rows.length === 0) {
      return;
    }
    const entry = this.getOrCreateEntry(key);
    entry.chunks.push(rows);
    entry.rowCount += rows.length;
    this.emit(entry);
  }

  getRowCount(key: TableResultStoreKey): number {
    return this.entries.get(toKey(key))?.rowCount ?? 0;
  }

  getRows(key: TableResultStoreKey): unknown[][] {
    const entry = this.entries.get(toKey(key));
    return entry ? entry.chunks.flat() : [];
  }

  getRowsFrom(key: TableResultStoreKey, start: number): unknown[][] {
    const entry = this.entries.get(toKey(key));
    if (!entry || start >= entry.rowCount) {
      return [];
    }

    const rows: unknown[][] = [];
    let offset = 0;
    for (const chunk of entry.chunks) {
      const chunkEnd = offset + chunk.length;
      if (chunkEnd > start) {
        rows.push(...chunk.slice(Math.max(0, start - offset)));
      }
      offset = chunkEnd;
    }
    return rows;
  }

  getRowsRange(key: TableResultStoreKey, start: number, end: number): unknown[][] {
    if (end <= start) {
      return [];
    }
    const entry = this.entries.get(toKey(key));
    if (!entry || start >= entry.rowCount) {
      return [];
    }

    const rows: unknown[][] = [];
    let offset = 0;
    for (const chunk of entry.chunks) {
      const chunkEnd = offset + chunk.length;
      if (chunkEnd <= start) {
        offset = chunkEnd;
        continue;
      }
      if (offset >= end) {
        break;
      }
      const from = Math.max(0, start - offset);
      const to = Math.min(chunk.length, end - offset);
      rows.push(...chunk.slice(from, to));
      offset = chunkEnd;
    }
    return rows;
  }

  getRow(key: TableResultStoreKey, index: number): unknown[] | undefined {
    const entry = this.entries.get(toKey(key));
    if (!entry || index < 0 || index >= entry.rowCount) {
      return undefined;
    }

    let offset = 0;
    for (const chunk of entry.chunks) {
      const chunkEnd = offset + chunk.length;
      if (index < chunkEnd) {
        return chunk[index - offset];
      }
      offset = chunkEnd;
    }
    return undefined;
  }

  subscribe(key: TableResultStoreKey, listener: () => void): () => void {
    const entry = this.getOrCreateEntry(key);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  private getOrCreateEntry(key: TableResultStoreKey): Entry {
    const id = toKey(key);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { chunks: [], rowCount: 0, listeners: new Set() };
      this.entries.set(id, entry);
    }
    return entry;
  }

  private emit(entry: Entry): void {
    for (const listener of entry.listeners) {
      listener();
    }
  }
}

function toKey(key: TableResultStoreKey): string {
  return `${key.fileId ?? ""}:${key.resultSetIndex}`;
}

const instance = new TableResultStore();

export function getTableResultStore(): TableResultStore {
  return instance;
}
