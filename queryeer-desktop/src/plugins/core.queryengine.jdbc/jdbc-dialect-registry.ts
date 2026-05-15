import type { ComponentType } from "react";
import type { SecretRefValue } from "../../contracts/security/Security";

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
};

const dialects = new Map<string, JdbcDialectContribution>();

export function registerJdbcDialect(contribution: JdbcDialectContribution): void {
  dialects.set(contribution.dialectId, contribution);
}

export function getJdbcDialect(dialectId: string): JdbcDialectContribution | undefined {
  return dialects.get(dialectId);
}
