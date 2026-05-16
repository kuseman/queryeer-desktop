import type { TreeAction } from "./tree-action-types";

type ChangeListener = () => void;

class TreeActionRegistryImpl {
  private actions: TreeAction[] = [];
  private listeners: ChangeListener[] = [];

  getActions(): TreeAction[] {
    return [...this.actions];
  }

  setActions(actions: TreeAction[]): void {
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

let instance: TreeActionRegistryImpl | undefined;

export function getTreeActionRegistry(): TreeActionRegistryImpl {
  if (!instance) {
    instance = new TreeActionRegistryImpl();
  }
  return instance;
}
