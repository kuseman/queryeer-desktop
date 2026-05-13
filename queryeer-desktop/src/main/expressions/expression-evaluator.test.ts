import { describe, expect, it } from "vitest";
import { wireExpressionEvaluatorIpc } from "./expression-evaluator.js";

type EvaluateHandler = (_event: unknown, params: {
  expression: string;
  context: Record<string, unknown>;
  functions: Record<string, unknown>;
  timeoutMs: number;
}) => Promise<unknown>;

function createHandler(): EvaluateHandler {
  let handler: EvaluateHandler | null = null;
  let syncHandler: ((_event: { returnValue: unknown }, params: {
    expression: string;
    context: Record<string, unknown>;
    functions: Record<string, unknown>;
    timeoutMs: number;
  }) => void) | null = null;
  const ipcMain = {
    handle: (channel: string, fn: EvaluateHandler) => {
      if (channel === "expressions:evaluate") {
        handler = fn;
      }
    },
    on: (channel: string, fn: (_event: { returnValue: unknown }, params: {
      expression: string;
      context: Record<string, unknown>;
      functions: Record<string, unknown>;
      timeoutMs: number;
    }) => void) => {
      if (channel === "expressions:evaluate-sync") {
        syncHandler = fn;
      }
    }
  };
  wireExpressionEvaluatorIpc(ipcMain as never);
  if (!handler) {
    throw new Error("expressions:evaluate handler was not wired");
  }
  if (!syncHandler) {
    throw new Error("expressions:evaluate-sync handler was not wired");
  }
  return handler;
}

describe("expression evaluator IPC", () => {
  it("evaluates plain expressions with context variables", async () => {
    const evaluate = createHandler();
    const result = await evaluate(null, {
      expression: "dialectId === 'sqlserver'",
      context: { dialectId: "sqlserver" },
      functions: {},
      timeoutMs: 100,
    });
    expect(result).toBe(true);
  });

  it("materializes serialized helper functions", async () => {
    const evaluate = createHandler();
    const result = await evaluate(null, {
      expression: "fn.math.add(2, 3)",
      context: {},
      functions: {
        math: {
          add: "(a, b) => a + b"
        }
      },
      timeoutMs: 100,
    });
    expect(result).toBe(5);
  });

  it("blocks direct access to eval and Function", async () => {
    const evaluate = createHandler();
    const result = await evaluate(null, {
      expression: "[typeof eval, typeof Function, typeof process, typeof require]",
      context: {},
      functions: {},
      timeoutMs: 100,
    });
    expect(result).toEqual(["undefined", "undefined", "undefined", "undefined"]);
  });

  it("blocks constructor chain via guarded globalThis", async () => {
    const evaluate = createHandler();
    const result = await evaluate(null, {
      expression: "typeof globalThis.constructor?.constructor",
      context: {},
      functions: {},
      timeoutMs: 100,
    });
    expect(result).toBe("undefined");
  });

  it("enforces timeout on runaway expressions", async () => {
    const evaluate = createHandler();
    await expect(
      evaluate(null, {
        expression: "while (true) {}",
        context: {},
        functions: {},
        timeoutMs: 25,
      })
    ).rejects.toThrow(/Script execution timed out|timed out/i);
  });
});
