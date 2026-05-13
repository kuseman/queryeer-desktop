import type { SymbolAction } from "./symbol-action-types";

type ChangeListener = () => void;

class SymbolActionRegistryImpl {
  private actions: SymbolAction[] = [];
  private listeners: ChangeListener[] = [];

  getSymbolActions(): SymbolAction[] {
    return [...this.actions];
  }

  setActions(actions: SymbolAction[]): void {
    this.actions = actions;
    for (const listener of this.listeners) {
      listener();
    }
  }

  onDidChangeActions(callback: ChangeListener): { dispose(): void } {
    this.listeners.push(callback);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== callback);
      }
    };
  }
}

let instance: SymbolActionRegistryImpl | undefined;

export function getSymbolActionRegistry(): SymbolActionRegistryImpl {
  if (!instance) {
    instance = new SymbolActionRegistryImpl();
  }
  return instance;
}
