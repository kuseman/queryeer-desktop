import type { ContextValues } from "./context-values";

export type ContextScope = {
  readonly id: string;
  readonly priority: number;
  context: ContextValues;
};

export type ContextChain = {
  /** Register a scope; returns an unregister disposable. */
  register(scope: ContextScope): () => void;
  /** Replace the context values for an already-registered scope. */
  update(id: string, context: ContextValues): void;
  /** Record the scope as the most-recently focused at its priority level. */
  activate(id: string): void;
  /** Registered scopes that currently participate in context resolution, sorted root→leaf. */
  getActiveChain(): readonly ContextScope[];
  /** Flattened merge of all scopes; higher priority wins on key conflicts. */
  getEffectiveContext(): ContextValues;
  /** Id of the most recently activated scope at the given priority, or null. */
  getLastFocusedScopeId(priority: number): string | null;
  /** Subscribe to any change in registered scopes or their context values. */
  onDidChange(listener: () => void): () => void;
};

export function createContextChain(): ContextChain {
  const scopes = new Map<string, ContextScope>();
  const lastActiveByPriority = new Map<number, string>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener();
    }
  };

  const sorted = (): ContextScope[] => {
    const byPriority = new Map<number, ContextScope[]>();
    for (const scope of scopes.values()) {
      const group = byPriority.get(scope.priority) ?? [];
      group.push(scope);
      byPriority.set(scope.priority, group);
    }

    const active: ContextScope[] = [];
    for (const [priority, group] of byPriority.entries()) {
      if (group.length === 1) {
        active.push(group[0]);
        continue;
      }
      const lastActiveId = lastActiveByPriority.get(priority);
      const lastActiveScope = lastActiveId ? scopes.get(lastActiveId) : undefined;
      if (lastActiveScope) {
        active.push(lastActiveScope);
      }
    }
    return active.sort((a, b) => a.priority - b.priority);
  };

  return {
    register(scope) {
      scopes.set(scope.id, { ...scope, context: { ...scope.context } });
      notify();
      return () => {
        scopes.delete(scope.id);
        if (lastActiveByPriority.get(scope.priority) === scope.id) {
          lastActiveByPriority.delete(scope.priority);
        }
        notify();
      };
    },

    update(id, context) {
      const scope = scopes.get(id);
      if (!scope) {
        return;
      }
      if (shallowEquals(scope.context, context)) {
        return;
      }
      scope.context = context;
      notify();
    },

    activate(id) {
      const scope = scopes.get(id);
      if (scope) {
        const previous = lastActiveByPriority.get(scope.priority);
        lastActiveByPriority.set(scope.priority, id);
        if (previous !== id) {
          notify();
        }
      }
    },

    getActiveChain() {
      return sorted();
    },

    getEffectiveContext() {
      return Object.assign({}, ...sorted().map((s) => s.context)) as ContextValues;
    },

    getLastFocusedScopeId(priority) {
      return lastActiveByPriority.get(priority) ?? null;
    },

    onDidChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function shallowEquals(left: ContextValues, right: ContextValues): boolean {
  if (left === right) {
    return true;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key) || left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}
