import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type { WhenExpressionTemplate } from "./when-expression-types";
import { createRefCountedList } from "./ref-counted-list";

const templates = createRefCountedList<WhenExpressionTemplate>((template) => `${template.name}\u0000${template.when}`);

/**
 * Adds templates; one with the same name and expression as a registered one is not listed twice. It stays listed
 * until every call that registered it is disposed. Plugins reach this through `context.whenExpressions.registerTemplates`.
 */
export function registerWhenExpressionTemplates(added: WhenExpressionTemplate[]): Disposable {
  return templates.add(added);
}

export function getRegisteredWhenExpressionTemplates(): WhenExpressionTemplate[] {
  return templates.items();
}
