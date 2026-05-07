import type { CtxVar } from "./when-expression-types";

const registered: CtxVar[] = [];

export function registerWhenExpressionVariables(vars: CtxVar[]): void {
  for (const v of vars) {
    if (!registered.some((r) => r.name === v.name)) {
      registered.push(v);
    }
  }
}

export function getRegisteredWhenExpressionVariables(): CtxVar[] {
  return registered;
}
