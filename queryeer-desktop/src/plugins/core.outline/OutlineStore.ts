import type { OutlineSymbol } from "../../contracts/extensions/OutlineExtension";

type OutlineStoreState = {
  symbols: OutlineSymbol[];
  selectedSymbolId: string | null;
  expandedSymbolIds: Set<string>;
  hasOutlineCapability: boolean;
  isLoading: boolean;
  error: string | null;
  showHelp: boolean;
};

export class OutlineStore {
  private state: OutlineStoreState;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.state = {
      symbols: [],
      selectedSymbolId: null,
      expandedSymbolIds: new Set(),
      hasOutlineCapability: false,
      isLoading: false,
      error: null,
      showHelp: false
    };
  }

  public getState(): OutlineStoreState {
    return this.state;
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public setSymbols(symbols: OutlineSymbol[]): void {
    this.state = { ...this.state, symbols };
    this.emit();
  }

  public setSelectedSymbolId(id: string | null): void {
    this.state = { ...this.state, selectedSymbolId: id };
    this.emit();
  }

  public toggleExpanded(symbolId: string): void {
    const next = new Set(this.state.expandedSymbolIds);
    if (next.has(symbolId)) {
      next.delete(symbolId);
    } else {
      next.add(symbolId);
    }
    this.state = { ...this.state, expandedSymbolIds: next };
    this.emit();
  }

  public setHasOutlineCapability(hasCapability: boolean): void {
    this.state = { ...this.state, hasOutlineCapability: hasCapability };
    this.emit();
  }

  public setError(message: string | null): void {
    this.state = { ...this.state, error: message };
    this.emit();
  }

  public setShowHelp(show: boolean): void {
    this.state = { ...this.state, showHelp: show };
    this.emit();
  }

  public clear(resetCapability?: boolean): void {
    this.state = {
      symbols: [],
      selectedSymbolId: null,
      expandedSymbolIds: new Set(),
      hasOutlineCapability: resetCapability ? false : this.state.hasOutlineCapability,
      isLoading: false,
      error: null,
      showHelp: this.state.showHelp
    };
    this.emit();
  }
}

let outlineStoreInstance: OutlineStore | undefined;

export function getOutlineStore(): OutlineStore {
  if (!outlineStoreInstance) {
    outlineStoreInstance = new OutlineStore();
  }
  return outlineStoreInstance;
}

export function createOutlineStore(): OutlineStore {
  outlineStoreInstance = new OutlineStore();
  return outlineStoreInstance;
}