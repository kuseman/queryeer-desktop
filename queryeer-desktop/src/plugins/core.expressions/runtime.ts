import { FunctionRegistry } from "./FunctionRegistry";
import { JsFunctionBackend, type ExpressionBackend } from "./backend";
import { renderExpressionTemplate } from "./template";
import { ExpressionRuntimeError, type ExpressionRuntime, type ExpressionRuntimeOptions } from "./types";

const DEFAULT_WHEN_TIMEOUT_MS = 50;
const DEFAULT_TEMPLATE_TIMEOUT_MS = 200;

export class ExpressionRuntimeService implements ExpressionRuntime {
  private readonly backend: ExpressionBackend;
  private readonly registry: FunctionRegistry;

  constructor(options?: { backend?: ExpressionBackend; registry?: FunctionRegistry }) {
    this.backend = options?.backend ?? new JsFunctionBackend();
    this.registry = options?.registry ?? new FunctionRegistry();
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
    try {
      return this.backend.evaluateSync<T>({
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

  async renderTemplate(template: string, context: Record<string, unknown>, options: ExpressionRuntimeOptions = {}): Promise<string> {
    return renderExpressionTemplate(this, template, context, options.source);
  }

  async dispose(): Promise<void> {
    await this.backend.dispose();
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
