import type { FileEntity } from "../../../contracts/files/FileEntity";

const jdbcQueryPlanDialects = new Set<string>();
const listeners = new Set<() => void>();

export function registerJdbcQueryPlanDialectSupport(dialectId: string): void {
  const normalizedDialectId = dialectId.trim();
  if (normalizedDialectId.length === 0) {
    return;
  }

  const previousSize = jdbcQueryPlanDialects.size;
  jdbcQueryPlanDialects.add(normalizedDialectId);
  if (jdbcQueryPlanDialects.size === previousSize) {
    return;
  }

  for (const listener of listeners) {
    listener();
  }
}

export function subscribeJdbcQueryPlanDialectSupport(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function supportsQueryPlanForJdbcDialect(dialectId: unknown): boolean {
  return typeof dialectId === "string" && jdbcQueryPlanDialects.has(dialectId.trim());
}

export function hasActiveQueryPlanDialect(file: FileEntity | null | undefined): boolean {
  if (!file || file.engineBinding?.engineId !== "jdbc") {
    return false;
  }
  return supportsQueryPlanForJdbcDialect(file.metadata?.["core.queryengine.jdbc.dialectId"]);
}
