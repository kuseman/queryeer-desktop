import type { LayoutViewContribution, SidebarZone } from "../../contracts/extensions/LayoutExtension";
import type { ContextValues } from "../../plugins/core.commands/context-values";
import { getExpressionRuntime } from "../../plugins/core.expressions/runtime";

export function filterSidebarViews(
  views: LayoutViewContribution[],
  zone: SidebarZone,
  context: ContextValues
): LayoutViewContribution[] {
  const runtime = getExpressionRuntime();
  return [...views]
    .filter((view) => view.defaultZone === zone)
    .filter((view) => {
      const expression = view.when;
      if (!expression || expression.trim().length === 0 || expression.trim() === "global") {
        return true;
      }
      try {
        return runtime.evaluateBooleanSync(expression, context as Record<string, unknown>, {
          mode: "when",
          source: `sidebar:${view.id}`,
          timeoutMs: 50,
        });
      } catch (error) {
        console.error(`[ExpressionRuntime][sidebar] '${view.id}' failed :: ${expression}`, error);
        return false;
      }
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
