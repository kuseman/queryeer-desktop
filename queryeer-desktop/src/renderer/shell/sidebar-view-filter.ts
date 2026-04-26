import type { LayoutViewContribution, SidebarZone } from "../../contracts/extensions/LayoutExtension";
import type { ContextValues } from "../../plugins/core.commands/when-evaluator";
import { evaluateWhenExpression } from "../../plugins/core.commands/when-evaluator";

export function filterSidebarViews(
  views: LayoutViewContribution[],
  zone: SidebarZone,
  context: ContextValues
): LayoutViewContribution[] {
  return [...views]
    .filter((view) => view.defaultZone === zone)
    .filter((view) => evaluateWhenExpression(view.when, context))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
