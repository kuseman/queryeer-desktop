import type { BackendLogEntry, BackendLogLevel } from "@queryeer/api/backend/index.js";

type BackendLogSource = "gateway" | "transport" | "backend";

export type AppendBackendLogParams = {
  level: BackendLogLevel;
  source: BackendLogSource;
  message: string;
};

export class BackendLogBuffer {
  private readonly entries: BackendLogEntry[] = [];

  public constructor(private readonly limit = 250) {}

  public append(params: AppendBackendLogParams): void {
    this.entries.push({
      timestamp: new Date().toISOString(),
      level: params.level,
      source: params.source,
      message: params.message
    });

    if (this.entries.length > this.limit) {
      this.entries.splice(0, this.entries.length - this.limit);
    }
  }

  public toArray(): BackendLogEntry[] {
    return [...this.entries];
  }

  public clear(): void {
    this.entries.length = 0;
  }
}
