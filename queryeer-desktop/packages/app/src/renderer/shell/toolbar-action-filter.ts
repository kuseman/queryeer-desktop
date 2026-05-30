import type { LayoutToolbarContribution } from "@queryeer/api/extensions/LayoutExtension";
import type { ContextValues } from "../../plugins/core.commands/context-values";
import { getExpressionRuntime } from "../../plugins/core.expressions/runtime";

export function filterToolbarActions(
  actions: LayoutToolbarContribution[],
  context: ContextValues
): LayoutToolbarContribution[] {
  const runtime = getExpressionRuntime();
  return [...actions]
    .filter((action) => {
      const expression = action.when;
      if (!expression || expression.trim().length === 0 || expression.trim() === "global") {
        return true;
      }
      try {
        return runtime.evaluateBooleanSync(expression, context as Record<string, unknown>, {
          mode: "when",
          source: `toolbar:${action.id}`,
          timeoutMs: 50,
        });
      } catch (error) {
        console.error(`[ExpressionRuntime][toolbar] '${action.id}' failed :: ${expression}`, error);
        return false;
      }
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
