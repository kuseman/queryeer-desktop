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

  it("renders nested template literals inside template expressions", async () => {
    const runtime = new ExpressionRuntimeService({ backend: createTestBackend() });
    const rendered = await runtime.renderTemplate(
      "${[1,2,3].map(x => `select * from table${x}`).join(' union all ')}",
      {}
    );
    expect(rendered).toBe(
      "select * from table1 union all select * from table2 union all select * from table3"
    );
  });

  it("renders expressions containing nested object braces", async () => {
    const runtime = new ExpressionRuntimeService({ backend: createTestBackend() });
    const rendered = await runtime.renderTemplate("${({ a: { b: 2 } }).a.b}", {});
    expect(rendered).toBe("2");
  });

  it("renders expressions containing closing braces in strings", async () => {
    const runtime = new ExpressionRuntimeService({ backend: createTestBackend() });
    const rendered = await runtime.renderTemplate("${'value with } brace'}", {});
    expect(rendered).toBe("value with } brace");
  });

  it("renders expressions containing brace-like comment text", async () => {
    const runtime = new ExpressionRuntimeService({ backend: createTestBackend() });
    const rendered = await runtime.renderTemplate(
      "${(() => { /* } */ return 7; })()}",
      {}
    );
    expect(rendered).toBe("7");
  });
});

describe("ExpressionRuntimeService synchronous when-expression cache", () => {
  function countingBackend(result: (request: EvaluateRequest) => unknown) {
    const calls: EvaluateRequest[] = [];
    const backend: ExpressionBackend = {
      evaluate: async () => {
        throw new Error("not used");
      },
      evaluateSync<T>(request: EvaluateRequest): T {
        calls.push(request);
        return result(request) as T;
      },
      dispose: async () => {}
    };
    return { backend, calls };
  }

  it("reuses a result for the same expression and context, briefly", () => {
    let now = 0;
    const { backend, calls } = countingBackend((request) => request.context.running === true);
    const runtime = new ExpressionRuntimeService({ backend, now: () => now });

    expect(runtime.evaluateBooleanSync("running", { running: true })).toBe(true);
    expect(runtime.evaluateBooleanSync("running", { running: true })).toBe(true);
    expect(calls).toHaveLength(1);

    expect(runtime.evaluateBooleanSync("running", { running: false })).toBe(false);
    expect(calls).toHaveLength(2);

    now = 1000;
    runtime.evaluateBooleanSync("running", { running: true });
    expect(calls).toHaveLength(3);
  });

  it("evaluates again once a function is registered", () => {
    const { backend, calls } = countingBackend(() => true);
    const runtime = new ExpressionRuntimeService({ backend, now: () => 0 });

    runtime.evaluateBooleanSync("fn.later.check()", {});
    runtime.getFunctionRegistry().registerNamespace("later", { check: () => true });
    runtime.evaluateBooleanSync("fn.later.check()", {});

    expect(calls).toHaveLength(2);
    expect(calls[1].functions).toHaveProperty("later");
  });

  it("caches only when-mode results, and never failures", () => {
    let fail = true;
    const { backend, calls } = countingBackend(() => {
      if (fail) {
        throw new Error("boom");
      }
      return 1;
    });
    const runtime = new ExpressionRuntimeService({ backend, now: () => 0 });

    expect(() => runtime.evaluateBooleanSync("x", {})).toThrow();
    fail = false;
    expect(runtime.evaluateBooleanSync("x", {})).toBe(true);
    runtime.evaluateValueSync("x", {}, { mode: "value" });
    runtime.evaluateValueSync("x", {}, { mode: "value" });

    expect(calls).toHaveLength(4);
  });

  it("doesn't cache when the context can't be serialized", () => {
    const { backend, calls } = countingBackend(() => true);
    const runtime = new ExpressionRuntimeService({ backend, now: () => 0 });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    runtime.evaluateBooleanSync("true", cyclic);
    runtime.evaluateBooleanSync("true", cyclic);

    expect(calls).toHaveLength(2);
  });
});
