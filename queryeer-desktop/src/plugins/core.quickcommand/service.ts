import type {
  QuickCommandContext,
  QuickCommandItem,
  QuickCommandProvider,
  QuickCommandRegistry
} from "../../contracts/extensions/QuickCommandExtension";
import { fuzzyScore } from "./fuzzy-match";
import { RecentlyUsedStore } from "./recently-used-store";

export type PanelState = { open: boolean; query: string };

type Listener = (state: PanelState) => void;

export class QuickCommandService {
  private readonly providers: QuickCommandProvider[];
  private readonly recentlyUsed = new RecentlyUsedStore();
  private state: PanelState = { open: false, query: "" };
  private readonly listeners: Listener[] = [];

  public constructor(providers: QuickCommandProvider[]) {
    this.providers = providers;
  }

  public open(prefillQuery = ""): void {
    this.setState({ open: true, query: prefillQuery });
  }

  public close(): void {
    this.setState({ open: false, query: "" });
  }

  public getState(): PanelState {
    return this.state;
  }

  public subscribe(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      const idx = this.listeners.indexOf(fn);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  public async execute(item: QuickCommandItem): Promise<void> {
    this.recentlyUsed.record(item.id);
    await item.action();
    this.close();
  }

  public async resolveItems(query: string, ctx: QuickCommandContext): Promise<QuickCommandItem[]> {
    const trimmed = query.trimStart();

    // Detect prefix: first char must match a registered prefix, followed by optional space.
    let activeProviders = this.providers;
    let searchQuery = trimmed;

    const firstChar = trimmed[0];
    if (firstChar && firstChar !== " ") {
      const prefixProviders = this.providers.filter((p) => p.prefix === firstChar);
      if (prefixProviders.length > 0) {
        activeProviders = prefixProviders;
        searchQuery = trimmed.slice(1).trimStart();
      }
    }

    const sorted = [...activeProviders].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const results = await Promise.all(
      sorted.map(async (provider) => {
        try {
          const items = await provider.getItems(searchQuery, ctx);
          return { provider, items };
        } catch {
          return { provider, items: [] as QuickCommandItem[] };
        }
      })
    );

    const isSearching = searchQuery.length > 0;

    const merged: QuickCommandItem[] = [];
    for (const { items } of results) {
      const scored: { item: QuickCommandItem; fuzzy: number; recency: number }[] = [];

      for (const item of items) {
        if (isSearching) {
          const score = fuzzyScore(searchQuery, item.title);
          if (score === null) {
            continue;
          }
          scored.push({ item, fuzzy: score, recency: this.recentlyUsed.getScore(item.id) });
        } else {
          scored.push({ item, fuzzy: 0, recency: this.recentlyUsed.getScore(item.id) });
        }
      }

      if (isSearching) {
        scored.sort((a, b) => b.fuzzy - a.fuzzy || b.recency - a.recency);
      } else {
        scored.sort((a, b) => b.recency - a.recency);
      }

      merged.push(...scored.map((s) => s.item));
    }

    return merged;
  }

  private setState(next: PanelState): void {
    this.state = next;
    for (const fn of this.listeners) {
      fn(next);
    }
  }
}

let serviceInstance: QuickCommandService | null = null;

export function initializeQuickCommandService(providers: QuickCommandProvider[]): QuickCommandService {
  serviceInstance = new QuickCommandService(providers);
  return serviceInstance;
}

export function getQuickCommandService(): QuickCommandService | null {
  return serviceInstance;
}

export function createQuickCommandRegistry(providers: QuickCommandProvider[]): QuickCommandRegistry {
  return {
    registerProvider: (provider) => {
      providers.push(provider);
    }
  };
}
