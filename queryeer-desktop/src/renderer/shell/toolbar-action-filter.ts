import type { LayoutToolbarContribution } from "../../contracts/extensions/LayoutExtension";
import type { ContextValues } from "../../plugins/core.commands/when-evaluator";
import { evaluateWhenExpression } from "../../plugins/core.commands/when-evaluator";

export function filterToolbarActions(
  actions: LayoutToolbarContribution[],
  context: ContextValues
): LayoutToolbarContribution[] {
  return [...actions]
    .filter((action) => evaluateWhenExpression(action.when, context))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
