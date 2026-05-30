import type { ContextChain } from "../core.commands/context-chain";
import type { ContextValues } from "../core.commands/context-values";
import { ContextPriority } from "../core.commands/context-priority";
import type { JdbcTreeNode } from "./jdbc-navigation-types";

const TREE_NODE_SCOPE_PREFIX = "core.queryengine.jdbc.treeNode";
let nextScopeIndex = 0;

let sharedChain: ContextChain | null = null;
let currentScopeId: string | null = null;

export function setJdbcTreeContextChain(chain: ContextChain): void {
  sharedChain = chain;
}

export function getJdbcTreeContextChain(): ContextChain | null {
  return sharedChain;
}

export function activateTreeNode(node: JdbcTreeNode): void {
  if (!sharedChain) return;

  if (currentScopeId) {
    sharedChain.update(currentScopeId, buildNodeContext(node));
    sharedChain.activate(currentScopeId);
    return;
  }

  const scopeId = `${TREE_NODE_SCOPE_PREFIX}.${nextScopeIndex++}`;
  currentScopeId = scopeId;
  sharedChain.register({
    id: scopeId,
    priority: ContextPriority.TREE_NODE,
    context: buildNodeContext(node)
  });
  sharedChain.activate(scopeId);
}

export function clearTreeNodeContext(): void {
  if (!sharedChain || !currentScopeId) return;
  sharedChain.update(currentScopeId, { node: null });
}

function buildNodeContext(node: JdbcTreeNode): ContextValues {
  return {
    node: {
      kind: node.kind,
      name: node.name,
      fullName: node.fullName ?? "",
      nodeType: node.nodeType,
      connectionId: node.connectionId,
      dialectId: node.dialectId,
      attributes: node.attributes ?? {}
    }
  };
}
