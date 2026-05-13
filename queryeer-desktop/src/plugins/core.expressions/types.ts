export type ExpressionMode = "when" | "template" | "value";

export type ExpressionRuntimeOptions = {
  timeoutMs?: number;
  mode?: ExpressionMode;
  source?: string;
};

export type ExpressionRuntimeErrorKind = "parse" | "runtime" | "timeout" | "cancelled";

export class ExpressionRuntimeError extends Error {
  readonly kind: ExpressionRuntimeErrorKind;
  readonly expression: string;
  readonly source?: string;
  readonly causeValue?: unknown;

  constructor(params: {
    kind: ExpressionRuntimeErrorKind;
    message: string;
    expression: string;
    source?: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.kind = params.kind;
    this.expression = params.expression;
    this.source = params.source;
    this.causeValue = params.cause;
  }
}

export type ExpressionRuntime = {
  evaluateBoolean(expression: string, context: Record<string, unknown>, options?: ExpressionRuntimeOptions): Promise<boolean>;
  evaluateValue<T = unknown>(expression: string, context: Record<string, unknown>, options?: ExpressionRuntimeOptions): Promise<T>;
  renderTemplate(template: string, context: Record<string, unknown>, options?: ExpressionRuntimeOptions): Promise<string>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExpressionFunction = (...args: any[]) => unknown;

export type ExpressionFunctionMeta = {
  signature: string;
  description: string;
  examples?: string[];
  since?: string;
  deprecated?: boolean;
};

export type RegisteredExpressionFunction = {
  fqName: string;
  fn: ExpressionFunction;
  meta?: ExpressionFunctionMeta;
};
