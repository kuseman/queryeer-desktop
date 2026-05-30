const STORAGE_KEY = "core.quickcommand.recentlyUsed";
const MAX_ENTRIES = 50;

type Entry = { id: string; ts: number };

export class RecentlyUsedStore {
  private entries: Entry[];

  public constructor() {
    this.entries = this.load();
  }

  public record(id: string): void {
    this.entries = this.entries.filter((e) => e.id !== id);
    this.entries.unshift({ id, ts: Date.now() });
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_ENTRIES);
    }
    this.persist();
  }

  /** Returns a score > 0 for known IDs (higher = more recent), 0 if unknown. */
  public getScore(id: string): number {
    const idx = this.entries.findIndex((e) => e.id === id);
    if (idx === -1) {
      return 0;
    }
    return MAX_ENTRIES - idx;
  }

  private load(): Entry[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (e): e is Entry =>
          typeof e === "object" && e !== null && typeof e.id === "string" && typeof e.ts === "number"
      );
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.entries));
    } catch {
      // quota exceeded or private browsing — best effort
    }
  }
}
