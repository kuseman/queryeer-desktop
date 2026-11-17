import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type {
  JdbcDialectContribution,
  JdbcDialectConnectionFormProps,
  JdbcDialectRegistry
} from "@queryeer/api/queryengine/JdbcDialectExtension.js";
import {
  registerJdbcQueryPlanDialectSupport,
  unregisterJdbcQueryPlanDialectSupport
} from "../core.queryengine/query-plan/supported-dialects";

export type { JdbcDialectContribution, JdbcDialectConnectionFormProps };

const dialects = new Map<string, JdbcDialectContribution>();
const listeners = new Set<() => void>();

/** Registers a dialect's frontend additions; disposing removes them again, unless a later registration replaced them. */
export function registerJdbcDialect(contribution: JdbcDialectContribution): Disposable {
  const previous = dialects.get(contribution.dialectId);
  if (previous?.supportsQueryPlan === true && contribution.supportsQueryPlan !== true) {
    unregisterJdbcQueryPlanDialectSupport(contribution.dialectId);
  }
  dialects.set(contribution.dialectId, contribution);
  if (contribution.supportsQueryPlan === true) {
    registerJdbcQueryPlanDialectSupport(contribution.dialectId);
  }
  notify();
  return {
    dispose: () => {
      if (dialects.get(contribution.dialectId) !== contribution) {
        return;
      }
      dialects.delete(contribution.dialectId);
      if (contribution.supportsQueryPlan === true) {
        unregisterJdbcQueryPlanDialectSupport(contribution.dialectId);
      }
      notify();
    }
  };
}

export function getJdbcDialect(dialectId: string): JdbcDialectContribution | undefined {
  return dialects.get(dialectId);
}

/** Called when a dialect is registered or removed, so open editors pick up a late plugin. */
export function subscribeJdbcDialects(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The `context.jdbcDialects` every plugin gets. */
export function createJdbcDialectRegistry(): JdbcDialectRegistry {
  return { registerDialect: registerJdbcDialect };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}
