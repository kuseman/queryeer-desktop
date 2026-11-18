import type { Disposable } from "@queryeer/api/editor/EditorApi";
import { setDisposable, toDisposable } from "../../core/plugin-runtime/disposables";
import type { GraphNodeTypeComponent, GraphNodeTypeContribution, GraphNodeTypeRegistry } from "@queryeer/api/graph/GraphNodeTypeExtension";

let sharedRegistry: GraphNodeTypeRegistry | null = null;

export function getGraphNodeTypeRegistry(): GraphNodeTypeRegistry {
  if (!sharedRegistry) {
    sharedRegistry = createNodeTypeRegistry();
  }
  return sharedRegistry;
}

export function resetGraphNodeTypeRegistry(): void {
  sharedRegistry = null;
}

function createNodeTypeRegistry(): GraphNodeTypeRegistry {
  const entries = new Map<string, GraphNodeTypeComponent>();

  return {
    registerNodeType(contribution: GraphNodeTypeContribution): Disposable {
      const kinds = typeof contribution.kind === "string" ? [contribution.kind] : contribution.kind;
      const registrations = kinds.map((kind) => setDisposable(entries, kind, contribution.component));
      return toDisposable(() => {
        for (const registration of registrations) {
          registration.dispose();
        }
      });
    },

    unregisterNodeType(kind: string): void {
      entries.delete(kind);
    },

    getComponent(kind: string): GraphNodeTypeComponent | undefined {
      return entries.get(kind);
    },

    getAll(): ReadonlyMap<string, GraphNodeTypeComponent> {
      return entries;
    }
  };
}
