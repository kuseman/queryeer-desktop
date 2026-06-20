export type TableResultStoreKey = {
  outputSessionId?: string;
  fileId?: string;
  resultSetIndex: number;
};

type TableResultStoreScope = {
  outputSessionId?: string;
  fileId?: string;
};

type Entry = {
  chunks: unknown[][][];
  rowCount: number;
  listeners: Set<() => void>;
};

class TableResultStore {
  private readonly entries = new Map<string, Entry>();

  clear(scope?: TableResultStoreScope): void {
    const hasSession = scope?.outputSessionId !== undefined;
    const hasFile = scope?.fileId !== undefined;
    if (!hasSession && !hasFile) {
      this.clearAll();
      return;
    }
    for (const [key, entry] of this.entries.entries()) {
      const parsed = parseStoreKey(key);
      if (!parsed) {
        continue;
      }
      if (hasSession && parsed.outputSessionId !== scope?.outputSessionId) {
        continue;
      }
      if (hasFile && parsed.fileId !== scope?.fileId) {
        continue;
      }
      entry.chunks = [];
      entry.rowCount = 0;
      this.emit(entry);
    }
  }

  clearAll(): void {
    for (const entry of this.entries.values()) {
      entry.chunks = [];
      entry.rowCount = 0;
      this.emit(entry);
    }
  }

  clearFile(fileId?: string): void {
    if (fileId === undefined) {
      this.clearAll();
      return;
    }
    this.clear({ fileId });
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
  return JSON.stringify([key.outputSessionId ?? "", key.fileId ?? "", key.resultSetIndex]);
}

function parseStoreKey(key: string): {
  outputSessionId: string;
  fileId: string;
  resultSetIndex: number;
} | null {
  try {
    const parsed = JSON.parse(key) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 3) {
      return null;
    }
    const [outputSessionId, fileId, resultSetIndex] = parsed;
    if (typeof outputSessionId !== "string" || typeof fileId !== "string" || typeof resultSetIndex !== "number") {
      return null;
    }
    return { outputSessionId, fileId, resultSetIndex };
  } catch {
    return null;
  }
}

const instance = new TableResultStore();

export function getTableResultStore(): TableResultStore {
  return instance;
}
