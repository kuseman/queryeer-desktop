import type { MenuItemContribution } from "../../contracts/extensions/MenuExtension";
import type { ContextValues } from "../core.commands/when-evaluator";
import { evaluateWhenExpression } from "../core.commands/when-evaluator";

export function filterMenuItemsByWhen(
  menuItems: MenuItemContribution[],
  context: ContextValues
): MenuItemContribution[] {
  const itemById = new Map(menuItems.map((item) => [item.id, item]));
  const visibleIds = new Set<string>();

  for (const item of menuItems) {
    if (evaluateWhenExpression(item.when, context)) {
      visibleIds.add(item.id);
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
