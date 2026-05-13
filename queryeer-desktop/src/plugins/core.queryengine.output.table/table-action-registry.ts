import type { TableAction } from "./table-action-types";

type ChangeListener = () => void;

class TableActionRegistryImpl {
  private actions: TableAction[] = [];
  private listeners: ChangeListener[] = [];

  getActions(): TableAction[] {
    return [...this.actions];
  }

  setActions(actions: TableAction[]): void {
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

let instance: TableActionRegistryImpl | undefined;

export function getTableActionRegistry(): TableActionRegistryImpl {
  if (!instance) {
    instance = new TableActionRegistryImpl();
  }
  return instance;
}
