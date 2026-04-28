import type { ContextValues } from "../../plugins/core.commands/when-evaluator";

type Primitive = string | number | boolean | undefined;

function isPrimitive(value: unknown): value is Primitive {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === undefined
  );
}

export function flattenContextObject(prefix: string, value: unknown): ContextValues {
  const result: ContextValues = {};

  const walk = (path: string, current: unknown): void => {
    if (isPrimitive(current)) {
      result[path] = current;
      return;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return;
    }
    for (const [key, next] of Object.entries(current as Record<string, unknown>)) {
      walk(`${path}.${key}`, next);
    }
  };

  walk(prefix, value);
  return result;
}
