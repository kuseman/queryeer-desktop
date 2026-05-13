import { describe, expect, it } from "vitest";
import { ExpressionRuntimeService } from "./runtime";
import type { ExpressionBackend, EvaluateRequest } from "./backend";

function createTestBackend(): ExpressionBackend {
  return {
    async evaluate<T>(request: EvaluateRequest): Promise<T> {
      const keys = Object.keys(request.context);
      const values = keys.map((key) => request.context[key]);
      const fnObj = materializeFunctions(request.functions) as Record<string, unknown>;
      const runner = new Function(...keys, "fn", `return (${request.expression});`) as (...args: unknown[]) => T;
      return runner(...values, fnObj);
    },
    async dispose(): Promise<void> {
      return;
    }
  };
}

function materializeFunctions(value: unknown): unknown {
  if (typeof value === "string") {
    return new Function(`return (${value});`)();
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeFunctions(item));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      next[k] = materializeFunctions(v);
    }
    return next;
  }
  return value;
}

describe("ExpressionRuntimeService", () => {
  it("evaluates boolean expressions", async () => {
    const runtime = new ExpressionRuntimeService({ backend: createTestBackend() });
    const result = await runtime.evaluateBoolean("value > 10", { value: 12 });
    expect(result).toBe(true);
  });

  it("uses registered namespace functions", async () => {
    const runtime = new ExpressionRuntimeService({ backend: createTestBackend() });
    runtime.getFunctionRegistry().registerNamespace("table", {
      hasColumn: (row: Record<string, unknown>, name: string) => Object.prototype.hasOwnProperty.call(row, name),
    });
    const result = await runtime.evaluateBoolean("fn.table.hasColumn(row, 'correlationId')", {
      row: { correlationId: "x" }
    });
    expect(result).toBe(true);
  });

  it("renders template placeholders", async () => {
    const runtime = new ExpressionRuntimeService({ backend: createTestBackend() });
    const query = await runtime.renderTemplate("SELECT * WHERE id = ${id}", { id: 5 });
    expect(query).toBe("SELECT * WHERE id = 5");
  });
});
