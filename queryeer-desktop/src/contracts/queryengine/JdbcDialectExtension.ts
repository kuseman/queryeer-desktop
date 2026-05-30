import type { ComponentType } from "react";
import type { SecretRefValue } from "../security/Security.js";

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
