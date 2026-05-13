import type { ExpressionRuntime } from "./types";

const TOKEN_REGEX = /\$\{([^}]+)\}/g;

export async function renderExpressionTemplate(
  runtime: Pick<ExpressionRuntime, "evaluateValue">,
  template: string,
  context: Record<string, unknown>,
  source?: string
): Promise<string> {
  let result = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_REGEX.exec(template)) !== null) {
    const [full, expr] = match;
    result += template.slice(lastIndex, match.index);
    const value = await runtime.evaluateValue(expr.trim(), context, {
      mode: "template",
      source,
    });
    result += value == null ? "" : String(value);
    lastIndex = match.index + full.length;
  }

  if (lastIndex < template.length) {
    result += template.slice(lastIndex);
  }

  return result;
}
