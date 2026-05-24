import type { ExpressionRuntime } from "./types";

type ScanMode =
  | "code"
  | "single-quote"
  | "double-quote"
  | "template-literal"
  | "line-comment"
  | "block-comment";

export async function renderExpressionTemplate(
  runtime: Pick<ExpressionRuntime, "evaluateValue">,
  template: string,
  context: Record<string, unknown>,
  source?: string
): Promise<string> {
  let result = "";
  let cursorIndex = 0;

  while (cursorIndex < template.length) {
    const tokenStartIndex = template.indexOf("${", cursorIndex);
    if (tokenStartIndex < 0) {
      result += template.slice(cursorIndex);
      break;
    }

    result += template.slice(cursorIndex, tokenStartIndex);
    const expressionStartIndex = tokenStartIndex + 2;
    const expressionEndIndex = findTemplateExpressionEnd(template, expressionStartIndex);
    if (expressionEndIndex < 0) {
      result += template.slice(tokenStartIndex);
      break;
    }

    if (expressionEndIndex === expressionStartIndex) {
      result += template.slice(tokenStartIndex, expressionEndIndex + 1);
      cursorIndex = expressionEndIndex + 1;
      continue;
    }

    const expression = template.slice(expressionStartIndex, expressionEndIndex).trim();
    const value = await runtime.evaluateValue(expression, context, {
      mode: "template",
      source,
    });
    result += value == null ? "" : String(value);
    cursorIndex = expressionEndIndex + 1;
  }

  return result;
}

function findTemplateExpressionEnd(template: string, expressionStartIndex: number): number {
  let braceDepth = 1;
  let mode: ScanMode = "code";
  const templateInterpolationReturnDepths: number[] = [];

  for (let index = expressionStartIndex; index < template.length; index += 1) {
    const current = template[index] ?? "";
    const next = template[index + 1] ?? "";

    if (mode === "code") {
      if (current === "'") {
        mode = "single-quote";
        continue;
      }
      if (current === "\"") {
        mode = "double-quote";
        continue;
      }
      if (current === "`") {
        mode = "template-literal";
        continue;
      }
      if (current === "/" && next === "/") {
        mode = "line-comment";
        index += 1;
        continue;
      }
      if (current === "/" && next === "*") {
        mode = "block-comment";
        index += 1;
        continue;
      }
      if (current === "{") {
        braceDepth += 1;
        continue;
      }
      if (current === "}") {
        braceDepth -= 1;
        if (braceDepth === 0) {
          return index;
        }
        const returnDepth = templateInterpolationReturnDepths[templateInterpolationReturnDepths.length - 1];
        if (returnDepth === braceDepth) {
          templateInterpolationReturnDepths.pop();
          mode = "template-literal";
        }
      }
      continue;
    }

    if (mode === "single-quote") {
      if (current === "\\") {
        index += 1;
        continue;
      }
      if (current === "'") {
        mode = "code";
      }
      continue;
    }

    if (mode === "double-quote") {
      if (current === "\\") {
        index += 1;
        continue;
      }
      if (current === "\"") {
        mode = "code";
      }
      continue;
    }

    if (mode === "template-literal") {
      if (current === "\\") {
        index += 1;
        continue;
      }
      if (current === "`") {
        mode = "code";
        continue;
      }
      if (current === "$" && next === "{") {
        templateInterpolationReturnDepths.push(braceDepth);
        braceDepth += 1;
        mode = "code";
        index += 1;
      }
      continue;
    }

    if (mode === "line-comment") {
      if (current === "\n" || current === "\r") {
        mode = "code";
      }
      continue;
    }

    if (mode === "block-comment") {
      if (current === "*" && next === "/") {
        mode = "code";
        index += 1;
      }
    }
  }

  return -1;
}
