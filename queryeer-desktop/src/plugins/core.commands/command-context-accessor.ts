import type { ContextChain } from "./context-chain";
import type { ContextValues } from "./when-evaluator";

let chain: ContextChain | null = null;

export function setCommandContextChain(c: ContextChain): void {
  chain = c;
}

export function getCommandContext(): ContextValues {
  return chain?.getEffectiveContext() ?? {};
}

export function subscribeCommandContext(listener: () => void): () => void {
  if (!chain) return () => {};
  return chain.onDidChange(listener);
}
