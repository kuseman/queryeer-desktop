import type { JdbcDialectContribution, JdbcDialectConnectionFormProps } from "@queryeer/api/queryengine/JdbcDialectExtension.js";
import { registerJdbcQueryPlanDialectSupport } from "../core.queryengine/query-plan/supported-dialects";

export type { JdbcDialectContribution, JdbcDialectConnectionFormProps };

const dialects = new Map<string, JdbcDialectContribution>();

export function registerJdbcDialect(contribution: JdbcDialectContribution): void {
  dialects.set(contribution.dialectId, contribution);
  if (contribution.supportsQueryPlan === true) {
    registerJdbcQueryPlanDialectSupport(contribution.dialectId);
  }
}

export function getJdbcDialect(dialectId: string): JdbcDialectContribution | undefined {
  return dialects.get(dialectId);
}
