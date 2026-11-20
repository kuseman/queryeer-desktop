import type { ExpressionFunction, ExpressionFunctionMeta, RegisteredExpressionFunction } from "./types";

export class FunctionRegistry {
  private readonly functions = new Map<string, RegisteredExpressionFunction>();
  private serializedBindings: Record<string, unknown> | null = null;
  private changeCount = 0;

  /** Changes whenever a function is registered, so results computed with the old set can be told apart. */
  get version(): number {
    return this.changeCount;
  }

  registerGlobalFunction(name: string, fn: ExpressionFunction, meta?: ExpressionFunctionMeta): void {
    this.register(name, fn, meta);
  }

  registerNamespace(
    namespace: string,
    functions: Record<string, ExpressionFunction>,
    metadata: Record<string, ExpressionFunctionMeta> = {}
  ): void {
    for (const [name, fn] of Object.entries(functions)) {
      this.register(`${namespace}.${name}`, fn, metadata[name]);
    }
  }

  listFunctions(): Array<{ fqName: string; meta?: ExpressionFunctionMeta }> {
    return [...this.functions.values()]
      .sort((a, b) => a.fqName.localeCompare(b.fqName))
      .map((entry) => ({ fqName: entry.fqName, meta: entry.meta }));
  }

  resolveRuntimeBindings(): Record<string, unknown> {
    const root: Record<string, unknown> = {};
    for (const [fqName, entry] of this.functions) {
      const segments = fqName.split(".");
      let current: Record<string, unknown> = root;
      for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i];
        if (!current[key] || typeof current[key] !== "object") {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }
      current[segments[segments.length - 1]] = entry.fn;
    }
    return root;
  }

  /** The functions as source text, for evaluation in the main process. Built once per set of functions; don't change it. */
  resolveSerializedBindings(): Record<string, unknown> {
    if (this.serializedBindings) {
      return this.serializedBindings;
    }
    const root: Record<string, unknown> = {};
    for (const [fqName, entry] of this.functions) {
      const segments = fqName.split(".");
      let current: Record<string, unknown> = root;
      for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i];
        if (!current[key] || typeof current[key] !== "object") {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }
      current[segments[segments.length - 1]] = entry.fn.toString();
    }
    this.serializedBindings = root;
    return root;
  }

  private register(fqName: string, fn: ExpressionFunction, meta?: ExpressionFunctionMeta): void {
    if (this.functions.has(fqName)) {
      throw new Error(`Expression function '${fqName}' is already registered.`);
    }
    this.functions.set(fqName, { fqName, fn, meta });
    this.serializedBindings = null;
    this.changeCount++;
  }
}
