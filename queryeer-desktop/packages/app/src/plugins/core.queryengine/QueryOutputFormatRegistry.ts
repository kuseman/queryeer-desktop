export type { OutputContext, ResultSet } from "@queryeer/api/queryengine/OutputExtension";
import type { Column, OutputContext, ResultSet } from "@queryeer/api/queryengine/OutputExtension";

/**
 * Formats a result file incrementally so arbitrarily large results never have to be
 * held in memory as one string. Concatenating every returned piece gives the file content.
 */
export type ResultFileWriter = {
  /** Starts a result set (closing the previous one, if any). */
  beginResultSet: (set: { resultSetIndex: number; columns: Column[] }) => string;
  /** Formats rows of the current result set. */
  writeRows: (rows: unknown[][]) => string;
  /** Closes the file. */
  end: () => string;
};

export type QueryResultFormatter = {
  id: string;
  label: string;
  /** Format for text display — full context with status and output lines. */
  format: (context: OutputContext) => string[];
  /** Format completed result sets as file content string. */
  formatFile: (resultSets: ResultSet[]) => string;
  /** Incremental variant of formatFile, used when writing results to a file. */
  createFileWriter: () => ResultFileWriter;
};

let registryInstance: QueryOutputFormatRegistry | undefined;

export function getQueryOutputFormatRegistry(): QueryOutputFormatRegistry {
  if (!registryInstance) {
    registryInstance = new QueryOutputFormatRegistry();
  }
  return registryInstance;
}

export class QueryOutputFormatRegistry {
  private readonly formatters: QueryResultFormatter[] = [];
  private readonly listeners: Array<() => void> = [];

  register(formatter: QueryResultFormatter): void {
    this.formatters.push(formatter);
    for (const listener of this.listeners) {
      listener();
    }
  }

  getFormatters(): QueryResultFormatter[] {
    return [...this.formatters];
  }

  getFormatter(id: string): QueryResultFormatter | undefined {
    return this.formatters.find((f) => f.id === id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }
}
