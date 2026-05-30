import type { ExpressionMode } from "./types";

export type EvaluateRequest = {
  expression: string;
  context: Record<string, unknown>;
  functions: Record<string, unknown>;
  mode: ExpressionMode;
  timeoutMs: number;
  source?: string;
};

export type ExpressionBackend = {
  evaluate<T = unknown>(request: EvaluateRequest): Promise<T>;
  evaluateSync?<T = unknown>(request: EvaluateRequest): T;
  dispose(): Promise<void>;
};

export class JsFunctionBackend implements ExpressionBackend {
  async evaluate<T = unknown>(request: EvaluateRequest): Promise<T> {
    if (!window.appShell.evaluateExpression) {
      throw new Error("Expression evaluation bridge is unavailable.");
    }
    return window.appShell.evaluateExpression({
      expression: request.expression,
      context: request.context,
      functions: request.functions,
      timeoutMs: request.timeoutMs,
      source: request.source,
    }) as Promise<T>;
  }

  async dispose(): Promise<void> {
    return;
  }

  evaluateSync<T = unknown>(request: EvaluateRequest): T {
    if (!window.appShell.evaluateExpressionSync) {
      throw new Error("Synchronous expression evaluation bridge is unavailable.");
    }
    const response = window.appShell.evaluateExpressionSync({
      expression: request.expression,
      context: request.context,
      functions: request.functions,
      timeoutMs: request.timeoutMs,
      source: request.source,
    });
    if (!response.ok) {
      throw new Error(response.message);
    }
    return response.result as T;
  }
}
