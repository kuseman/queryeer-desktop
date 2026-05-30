import type { WhenExpressionTemplate } from "./when-expression-types";

const registered: WhenExpressionTemplate[] = [];

export function registerWhenExpressionTemplates(templates: WhenExpressionTemplate[]): void {
  for (const template of templates) {
    if (!registered.some((r) => r.name === template.name && r.when === template.when)) {
      registered.push(template);
    }
  }
}

export function getRegisteredWhenExpressionTemplates(): WhenExpressionTemplate[] {
  return registered;
}
