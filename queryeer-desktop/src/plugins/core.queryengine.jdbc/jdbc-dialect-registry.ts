import type { ComponentType } from "react";
import type { SecretRefValue } from "../../contracts/security/Security";
import { registerJdbcQueryPlanDialectSupport } from "../core.queryengine/query-plan/supported-dialects";

export type JdbcDialectConnectionFormProps = {
  connectionId: string;
  properties: Record<string, unknown>;
  password?: SecretRefValue;
  readonly: boolean;
  onChange: (patch: { properties?: Record<string, unknown>; password?: SecretRefValue }) => void;
};

export type JdbcDialectContribution = {
  dialectId: string;
  ConnectionForm?: ComponentType<JdbcDialectConnectionFormProps>;
  supportsQueryPlan?: boolean;
};

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
