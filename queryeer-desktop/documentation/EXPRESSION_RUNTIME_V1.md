# ExpressionRuntime v1 (Fast-to-Ship) Design

## Purpose

Introduce a reusable ExpressionRuntime service that powers:

- rule evaluation (`when`-style expressions)
- template interpolation (`${...}` placeholders)

without building a custom parser/evaluator from scratch.

This design targets v1 fast delivery using existing JavaScript runtime functionality, while keeping APIs stable so a stronger-isolation backend can replace the engine later.

## Goals

- Single runtime surface for rules and templates.
- Clear extension model for core and module-provided functions.
- Structured context support (no flatten-first requirement).
- Async API contract (backend-swappable).
- Timeouts, cancellation, typed errors, and diagnostics.
- Incremental migration from current `when-evaluator`.

## Non-Goals (v1)

- Full legacy migration in one release.
- Advanced policy sandboxing/isolation hardening.
- Feature-complete expression authoring UI.

## High-Level Architecture

### Components

1. ExpressionRuntime (public service)
   - Stable API consumed by plugins/modules.
2. ExpressionBackend (internal adapter)
   - v1 implementation: worker-based JavaScript evaluator.
   - v2+ can swap to stronger-isolation engine.
3. FunctionRegistry
   - Registers global and namespaced functions.
   - Provides metadata for docs/tooling.
4. TemplateRenderer
   - Parses `${...}` segments.
   - Evaluates segments via ExpressionRuntime.
5. Context Providers
   - Build structured context objects for each caller (table/editor/etc).

## API Contracts (TypeScript)

```ts
export type ExpressionMode = "when" | "template" | "value";

export type ExpressionRuntimeOptions = {
  timeoutMs?: number;
  mode?: ExpressionMode;
  source?: string;
};

export type ExpressionRuntimeErrorKind = "parse" | "runtime" | "timeout" | "cancelled";

export type ExpressionRuntimeError = {
  kind: ExpressionRuntimeErrorKind;
  message: string;
  expression: string;
  source?: string;
  position?: { line: number; column: number };
  cause?: unknown;
};

export type ExpressionRuntime = {
  evaluateBoolean(expression: string, context: Record<string, unknown>, options?: ExpressionRuntimeOptions): Promise<boolean>;
  evaluateValue<T = unknown>(expression: string, context: Record<string, unknown>, options?: ExpressionRuntimeOptions): Promise<T>;
  renderTemplate(template: string, context: Record<string, unknown>, options?: ExpressionRuntimeOptions): Promise<string>;
};
```

### Backend Adapter Contract

```ts
export type ExpressionBackend = {
  evaluate<T = unknown>(request: {
    expression: string;
    context: Record<string, unknown>;
    functions: SerializedFunctionRegistry;
    mode: ExpressionMode;
    timeoutMs: number;
    source?: string;
  }): Promise<T>;

  dispose(): Promise<void>;
};
```

## Function Registry Design

### Registration API

```ts
export type ExpressionFunction = (...args: unknown[]) => unknown;

export type ExpressionFunctionMeta = {
  signature: string;
  description: string;
  examples?: string[];
  since?: string;
  deprecated?: boolean;
};

export type FunctionRegistry = {
  registerGlobalFunction(name: string, fn: ExpressionFunction, meta?: ExpressionFunctionMeta): void;
  registerNamespace(namespace: string, functions: Record<string, ExpressionFunction>, meta?: Record<string, ExpressionFunctionMeta>): void;
  listFunctions(): Array<{ fqName: string; meta?: ExpressionFunctionMeta }>;
};
```

### Naming Policy

- Prefer namespaced functions for module/domain helpers.
- Core should expose namespaced helpers (`date.add`, `sql.literal`).
- Silent collisions are disallowed by default.

## v1 Backend: Worker-Based JavaScript Evaluator

### Why

- Fast to ship.
- Prevents UI-thread blocking.
- Keeps engine replaceable.

### Execution Model

- Host sends evaluate request to dedicated worker.
- Worker compiles/caches expression by hash.
- Worker executes with explicit scope: `context` and `fn`.
- Host enforces timeout and restarts worker on timeout/fault.

### Compilation Strategy

- Expression wrapped into callable (`return (<expression>);`).
- Cache key: `hash(expression + mode)`.
- Template segments compiled/evaluated individually.

### Error Handling

- Normalize parse/runtime exceptions into `ExpressionRuntimeError`.
- Include source and best-effort position.
- Never leak raw exceptions to caller surface.

## Template Rendering (`${...}`)

### Rules

- Parse template into literal and expression tokens.
- Evaluate each token with same runtime/context.
- Stringify (`null/undefined => ""`).
- Fail fast on first expression error.

### Example

```sql
SELECT * FROM _doc
WHERE correlationId = '${sql.literal(table.value(table.primaryRow(), "correlationId"))}'
AND "@timestamp" >= '${date.add(table.value(table.primaryRow(), "@timestamp"), "minute", -5)}'
```

## Structured Context Model (v1)

For table actions, recommended shape:

```ts
{
  selection: {
    cells: Array<{ rowIndex: number; columnIndex: number; columnName: string; value: unknown }>;
    rows: Array<{ rowIndex: number; valuesByColumn: Record<string, unknown> }>;
    columns: Array<{ index: number; name: string; type: string }>;
    primaryRowIndex: number | null;
  };
  table: {
    resultSetIndex: number;
  };
}
```

Legacy flattened keys can be bridged temporarily where needed.

## Initial Function Packs

### Core Pack

- `date.add(value, unit, amount)`
- `date.format(value, format?)`
- `string.lower(value)`, `string.upper(value)`, `string.contains(value, part)`
- `math.abs(value)`, `math.round(value)`
- `coalesce(...values)`
- `regex.test(pattern, value)`
- `sql.literal(value)`

### Table Pack

- `table.hasColumn(row, name)`
- `table.value(row, columnName)`
- `table.primaryRow()`
- `table.selectedRows()`
- `table.selectedCells()`

## Integration Plan

### Phase 1: Foundation

- Add ExpressionRuntime service and FunctionRegistry.
- Add worker backend adapter.
- Add template renderer.

### Phase 2: First Consumer (Table Context Menu)

- Evaluate provider-level and item-level expressions via runtime.
- Render template-based actions via runtime.
- Register table helper functions.

### Phase 3: Compatibility Bridge

- Keep old `when-evaluator` active.
- Add adapter path for targeted consumers.

### Phase 4: Incremental Migration

- Migrate symbol actions.
- Migrate quick command filters.
- Migrate keybinding `when` contexts.
- Remove old evaluator after parity.

## Observability

Track:

- evaluations total/success/failure/timeout
- average eval duration
- worker restart count
- top failing sources

## Testing Strategy

### Unit

- evaluateBoolean/value behavior
- template interpolation tokenization/eval
- function registration and collision policy
- timeout behavior and worker recycling
- error normalization

### Integration

- table context menu visibility using value-based expressions
- table template generation with date arithmetic

### Regression

- async rejection handling
- deterministic result serialization
- worker restart after fatal error/timeout

## Open Decisions

1. Expression syntax strictness (expression-only JS subset for v1).
2. Template error policy (fail-fast in v1).
3. Function override policy (prohibit by default).
4. Default timeout values (`when`: 50ms, `template`: 200ms).

## Future: v2 Backend Swap

Keep `ExpressionRuntime` and `FunctionRegistry` contracts unchanged.
Swap the backend implementation only.
