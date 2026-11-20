import { FunctionRegistry } from "./FunctionRegistry";
import { JsFunctionBackend, type ExpressionBackend } from "./backend";
import { renderExpressionTemplate } from "./template";
import { ExpressionRuntimeError, type ExpressionRuntime, type ExpressionRuntimeOptions } from "./types";

const DEFAULT_WHEN_TIMEOUT_MS = 50;
/**
 * How long a synchronous when-expression result is reused for the same expression and context. Each evaluation is a
 * blocking call to the main process, and a render evaluates the same expressions for the toolbar, menus and views,
 * several times over. Short, so an expression that reads the time (it can use `Date`) stays about right.
 */
const SYNC_WHEN_CACHE_TTL_MS = 1000;
const SYNC_WHEN_CACHE_MAX_ENTRIES = 1000;
const DEFAULT_TEMPLATE_TIMEOUT_MS = 200;

export class ExpressionRuntimeService implements ExpressionRuntime {
  private readonly backend: ExpressionBackend;
  private readonly registry: FunctionRegistry;

  private readonly now: () => number;
  private readonly syncWhenResults = new Map<string, { value: unknown; at: number }>();

  constructor(options?: { backend?: ExpressionBackend; registry?: FunctionRegistry; now?: () => number }) {
    this.backend = options?.backend ?? new JsFunctionBackend();
    this.registry = options?.registry ?? new FunctionRegistry();
    this.now = options?.now ?? (() => Date.now());
  }

  getFunctionRegistry(): FunctionRegistry {
    return this.registry;
  }

  async evaluateBoolean(expression: string, context: Record<string, unknown>, options: ExpressionRuntimeOptions = {}): Promise<boolean> {
    const value = await this.evaluateValue(expression, context, { ...options, mode: options.mode ?? "when" });
    return !!value;
  }

  evaluateBooleanSync(expression: string, context: Record<string, unknown>, options: ExpressionRuntimeOptions = {}): boolean {
    const value = this.evaluateValueSync(expression, context, { ...options, mode: options.mode ?? "when" });
    return !!value;
  }

  async evaluateValue<T = unknown>(expression: string, context: Record<string, unknown>, options: ExpressionRuntimeOptions = {}): Promise<T> {
    const mode = options.mode ?? "value";
    const timeoutMs = options.timeoutMs
      ?? (mode === "template" ? DEFAULT_TEMPLATE_TIMEOUT_MS : DEFAULT_WHEN_TIMEOUT_MS);
    try {
      return await this.backend.evaluate<T>({
        expression,
        context,
        functions: this.registry.resolveSerializedBindings(),
        mode,
        timeoutMs,
        source: options.source,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = message.toLowerCase().includes("timed out") ? "timeout" : "runtime";
      throw new ExpressionRuntimeError({
        kind,
        message,
        expression,
        source: options.source,
        cause: error,
      });
    }
  }

  evaluateValueSync<T = unknown>(expression: string, context: Record<string, unknown>, options: ExpressionRuntimeOptions = {}): T {
    const mode = options.mode ?? "value";
    const timeoutMs = options.timeoutMs
      ?? (mode === "template" ? DEFAULT_TEMPLATE_TIMEOUT_MS : DEFAULT_WHEN_TIMEOUT_MS);
    if (!this.backend.evaluateSync) {
      throw new ExpressionRuntimeError({
        kind: "runtime",
        message: "Synchronous evaluation is not supported by backend.",
        expression,
        source: options.source,
      });
    }
    const cacheKey = mode === "when" ? syncWhenCacheKey(this.registry.version, expression, context) : undefined;
    if (cacheKey !== undefined) {
      const cached = this.syncWhenResults.get(cacheKey);
      if (cached && this.now() - cached.at < SYNC_WHEN_CACHE_TTL_MS) {
        return cached.value as T;
      }
    }
    try {
      const value = this.backend.evaluateSync<T>({
        expression,
        context,
        functions: this.registry.resolveSerializedBindings(),
        mode,
        timeoutMs,
        source: options.source,
      });
      if (cacheKey !== undefined) {
        if (this.syncWhenResults.size >= SYNC_WHEN_CACHE_MAX_ENTRIES) {
          this.syncWhenResults.clear();
        }
        this.syncWhenResults.set(cacheKey, { value, at: this.now() });
      }
      return value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = message.toLowerCase().includes("timed out") ? "timeout" : "runtime";
      throw new ExpressionRuntimeError({
        kind,
        message,
        expression,
        source: options.source,
        cause: error,
      });
    }
  }

  async renderTemplate(template: string, context: Record<string, unknown>, options: ExpressionRuntimeOptions = {}): Promise<string> {
    return renderExpressionTemplate(this, template, context, options.source);
  }

  async dispose(): Promise<void> {
    await this.backend.dispose();
  }
}

/** The cache key for a when-expression result; undefined (no caching) when the context can't be serialized. */
function syncWhenCacheKey(functionsVersion: number, expression: string, context: Record<string, unknown>): string | undefined {
  try {
    return `${functionsVersion}\u0000${expression}\u0000${JSON.stringify(context)}`;
  } catch {
    return undefined;
  }
}

let runtimeInstance: ExpressionRuntimeService | null = null;

export function getExpressionRuntime(): ExpressionRuntimeService {
  if (!runtimeInstance) {
    runtimeInstance = new ExpressionRuntimeService();
    runtimeInstance.getFunctionRegistry().registerNamespace("date", {
      add: (value: unknown, unit: string, amount: number) => {
        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) {
          return "";
        }
        const next = new Date(date);
        if (unit === "minute" || unit === "minutes") next.setMinutes(next.getMinutes() + amount);
        else if (unit === "hour" || unit === "hours") next.setHours(next.getHours() + amount);
        else if (unit === "day" || unit === "days") next.setDate(next.getDate() + amount);
        else return date.toISOString();
        return next.toISOString();
      }
    });
    runtimeInstance.getFunctionRegistry().registerNamespace("sql", {
      literal: (value: unknown) => {
        if (value === null || value === undefined) return "NULL";
        return `'${String(value).replace(/'/g, "''")}'`;
      }
    });
  }
  return runtimeInstance;
}
