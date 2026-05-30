import type { MenuItemContribution } from "@queryeer/api/extensions/MenuExtension";
import type { ContextValues } from "../core.commands/context-values";
import { getExpressionRuntime } from "../core.expressions/runtime";

export function filterMenuItemsByWhen(
  menuItems: MenuItemContribution[],
  context: ContextValues
): MenuItemContribution[] {
  const runtime = getExpressionRuntime();
  const itemById = new Map(menuItems.map((item) => [item.id, item]));
  const visibleIds = new Set<string>();

  for (const item of menuItems) {
    const expression = item.when;
    if (!expression || expression.trim().length === 0 || expression.trim() === "global") {
      visibleIds.add(item.id);
      continue;
    }
    try {
      if (runtime.evaluateBooleanSync(expression, context as Record<string, unknown>, {
        mode: "when",
        source: `menu:${item.id}`,
        timeoutMs: 50,
      })) {
        visibleIds.add(item.id);
      }
    } catch (error) {
      console.error(`[ExpressionRuntime][menu] '${item.id}' failed :: ${expression}`, error);
    }
  }

  for (const id of [...visibleIds]) {
    let cursor = itemById.get(id);
    while (cursor?.parentId) {
      visibleIds.add(cursor.parentId);
      cursor = itemById.get(cursor.parentId);
    }
  }

  return menuItems.filter((item) => visibleIds.has(item.id));
}
