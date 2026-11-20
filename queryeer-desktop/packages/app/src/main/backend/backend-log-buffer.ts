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

    while (this.entries.length > this.limit) {
      // Evict the oldest low-priority entry first so a burst of debug/info
      // traffic cannot push warnings and errors out before they are read.
      const lowPriorityIndex = this.entries.findIndex((entry) => !isHighPriority(entry.level));
      this.entries.splice(lowPriorityIndex >= 0 ? lowPriorityIndex : 0, 1);
    }
  }

  public toArray(): BackendLogEntry[] {
    return [...this.entries];
  }

  public removeLevel(level: BackendLogLevel): void {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i].level === level) {
        this.entries.splice(i, 1);
      }
    }
  }

  public clear(): void {
    this.entries.length = 0;
  }
}

function isHighPriority(level: BackendLogLevel): boolean {
  return level === "warn" || level === "error";
}
