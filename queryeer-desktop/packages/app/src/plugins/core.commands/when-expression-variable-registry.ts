import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type { WhenExpressionRegistry } from "@queryeer/api/commands/WhenExpressionTypes.js";
import type { CtxVar } from "./when-expression-types";
import { createRefCountedList } from "./ref-counted-list";
import { registerWhenExpressionTemplates } from "./when-expression-template-registry";

const variables = createRefCountedList<CtxVar>((variable) => variable.name);

/**
 * Adds variables; one whose name is already registered is not listed twice. It stays listed until every call that
 * registered it is disposed. Plugins reach this through `context.whenExpressions.registerVariables`.
 */
export function registerWhenExpressionVariables(added: CtxVar[]): Disposable {
  return variables.add(added);
}

export function getRegisteredWhenExpressionVariables(): CtxVar[] {
  return variables.items();
}

/** The `context.whenExpressions` every plugin gets. */
export function createWhenExpressionRegistry(): WhenExpressionRegistry {
  return {
    registerTemplates: registerWhenExpressionTemplates,
    registerVariables: registerWhenExpressionVariables
  };
}
