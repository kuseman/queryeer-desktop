import type { IpcMain } from "electron";
import { runInNewContext } from "node:vm";

type EvaluateExpressionParams = {
  expression: string;
  context: Record<string, unknown>;
  functions: Record<string, unknown>;
  timeoutMs: number;
};

function materializeFunctions(value: unknown): unknown {
  if (typeof value === "string") {
    return runInNewContext(`(${value})`, {});
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

function guardValue<T>(value: T): T {
  if (value === null || value === undefined) {
    return value;
  }
  const type = typeof value;
  if (type !== "object" && type !== "function") {
    return value;
  }

  const blocked = new Set(["constructor", "prototype", "__proto__"]);
  const target = value as unknown as Record<string, unknown>;

  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (typeof prop === "string" && blocked.has(prop)) {
        return undefined;
      }
      const next = Reflect.get(obj, prop, receiver);
      return guardValue(next);
    },
    getPrototypeOf() {
      return null;
    }
  }) as unknown as T;
}

function createExpressionScope(
  context: Record<string, unknown>,
  functions: Record<string, unknown>
): Record<string, unknown> {
  const scope = Object.create(null) as Record<string, unknown>;
  const guardedContext = guardValue(context);
  const guardedFunctions = guardValue(functions);

  for (const [k, v] of Object.entries(context)) {
    scope[k] = guardValue(v);
  }

  const structured = inflateDottedKeys(context);
  for (const [k, v] of Object.entries(structured)) {
    if (!(k in scope)) {
      scope[k] = guardValue(v);
    }
  }

  scope.context = guardedContext;
  scope.fn = guardedFunctions;
  scope.globalThis = guardValue({ context: guardedContext, fn: guardedFunctions });
  scope.global = undefined;
  scope.process = undefined;
  scope.require = undefined;
  scope.Buffer = undefined;
  scope.Function = undefined;
  scope.eval = undefined;

  return scope;
}

function inflateDottedKeys(flat: Record<string, unknown>): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (!key.includes(".")) {
      continue;
    }
    const segments = key.split(".").filter((s) => s.length > 0);
    if (segments.length === 0) {
      continue;
    }
    let cursor: Record<string, unknown> = root;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;
      if (isLast) {
        if (!(segment in cursor)) {
          cursor[segment] = value;
        }
      } else {
        const next = cursor[segment];
        if (!next || typeof next !== "object" || Array.isArray(next)) {
          cursor[segment] = {};
        }
        cursor = cursor[segment] as Record<string, unknown>;
      }
    }
  }
  return root;
}

export function wireExpressionEvaluatorIpc(ipcMain: IpcMain): void {
  ipcMain.handle("expressions:evaluate", async (_event, params: EvaluateExpressionParams) => {
    const fnBindings = materializeFunctions(params.functions) as Record<string, unknown>;
    const scope = createExpressionScope(params.context, fnBindings);
    return runInNewContext(params.expression, scope, {
      timeout: params.timeoutMs,
      contextCodeGeneration: {
        strings: false,
        wasm: false
      }
    });
  });

  ipcMain.on("expressions:evaluate-sync", (event, params: EvaluateExpressionParams) => {
    try {
      const fnBindings = materializeFunctions(params.functions) as Record<string, unknown>;
      const scope = createExpressionScope(params.context, fnBindings);
      const result = runInNewContext(params.expression, scope, {
        timeout: params.timeoutMs,
        contextCodeGeneration: {
          strings: false,
          wasm: false
        }
      });
      event.returnValue = { ok: true, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      event.returnValue = { ok: false, message };
    }
  });
}
