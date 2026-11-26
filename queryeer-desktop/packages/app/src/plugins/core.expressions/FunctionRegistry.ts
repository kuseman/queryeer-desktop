import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type { ExpressionFunction, ExpressionFunctionMeta, RegisteredExpressionFunction } from "./types";

/** A namespace or function name: one segment of `fn.<namespace>.<name>`. */
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Identifiers that would reach `Object.prototype` when the bindings are built. */
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

export class FunctionRegistry {
  private readonly functions = new Map<string, RegisteredExpressionFunction>();
  private serializedBindings: Record<string, unknown> | null = null;
  private changeCount = 0;

  /** Changes whenever a function is registered or removed, so results computed with the old set can be told apart. */
  get version(): number {
    return this.changeCount;
  }

  registerGlobalFunction(name: string, fn: ExpressionFunction, meta?: ExpressionFunctionMeta): void {
    this.register(name, fn, meta);
  }

  /**
   * Adds `functions` as `fn.<namespace>.<name>`, all or none: an invalid name, or one already registered, throws before
   * any is added. Disposing removes the ones this call added.
   */
  registerNamespace(
    namespace: string,
    functions: Record<string, ExpressionFunction>,
    metadata: Record<string, ExpressionFunctionMeta> = {}
  ): Disposable {
    const entries = Object.entries(functions);
    for (const name of [namespace, ...entries.map(([functionName]) => functionName)]) {
      if (!IDENTIFIER.test(name) || RESERVED.has(name)) {
        throw new Error(`Invalid expression function name '${name}': use a JavaScript identifier.`);
      }
    }
    for (const [name, fn] of entries) {
      if (typeof fn !== "function") {
        throw new Error(`Expression function '${namespace}.${name}' is not a function.`);
      }
      if (this.functions.has(`${namespace}.${name}`)) {
        throw new Error(`Expression function '${namespace}.${name}' is already registered.`);
      }
    }
    const added = entries.map(([name, fn]) => this.register(`${namespace}.${name}`, fn, metadata[name]));
    return {
      dispose: () => {
        for (const entry of added.splice(0)) {
          // A later registration under the same name stays
          if (this.functions.get(entry.fqName) === entry) {
            this.functions.delete(entry.fqName);
            this.changed();
          }
        }
      }
    };
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

  private register(fqName: string, fn: ExpressionFunction, meta?: ExpressionFunctionMeta): RegisteredExpressionFunction {
    if (this.functions.has(fqName)) {
      throw new Error(`Expression function '${fqName}' is already registered.`);
    }
    const entry: RegisteredExpressionFunction = { fqName, fn, meta };
    this.functions.set(fqName, entry);
    this.changed();
    return entry;
  }

  private changed(): void {
    this.serializedBindings = null;
    this.changeCount++;
  }
}
