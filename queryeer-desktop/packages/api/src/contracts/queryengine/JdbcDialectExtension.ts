import type { ComponentType } from "react";
import type { Disposable } from "../editor/EditorApi.js";
import type { SecretRefValue } from "../security/Security.js";

/**
 * The type of a connection form field. A dialect defines its fields in its backend `JdbcDialect.connectionSetup()`,
 * and Queryeer renders the form from them.
 * - `SECRET` is stored as the connection's password (a reference into the security vault), not in its properties.
 * - `FOLDER_PATH` and `FILE_PATH` are paths with a browse button that picks a folder or a file.
 */
export type JdbcConnectionFieldType = "TEXT" | "NUMBER" | "SECRET" | "BOOLEAN" | "SELECT" | "FOLDER_PATH" | "FILE_PATH";

export type JdbcConnectionFieldOption = {
  value: string;
  label: string;
};

/** One field of a dialect's connection form, as the backend dialect defines it (`JdbcConnectionFieldDefinition`). */
export type JdbcConnectionFieldDefinition = {
  /** The key in the connection's properties, which the backend dialect's `buildUrl` reads. */
  id: string;
  label: string;
  type: JdbcConnectionFieldType;
  /** A required field that is empty marks the connection invalid. Not checked for `SECRET`. */
  required: boolean;
  /** Help text under the field. */
  description?: string | null;
  /** The choices of a `SELECT` field. */
  options?: JdbcConnectionFieldOption[] | null;
  /** Shown when the property is not set, and stored with the connection when it is saved. */
  defaultValue?: unknown;
  /** The field is shown only when every other field named here has the given value. */
  visibleWhen?: Record<string, string> | null;
};

/** A dialect's connection form, as returned by the JDBC engine's `jdbc.connection.dialects` action. */
export type JdbcConnectionSetupDefinition = {
  fields: JdbcConnectionFieldDefinition[];
};

export type JdbcDialectConnectionFormProps = {
  connectionId: string;
  properties: Record<string, unknown>;
  password?: SecretRefValue;
  readonly: boolean;
  onChange: (patch: { properties?: Record<string, unknown>; password?: SecretRefValue }) => void;
};

/**
 * Frontend additions for a JDBC dialect. A dialect works without one: its backend `JdbcDialect` lists it, and its
 * `connectionSetup()` fields give it a connection form. Register a contribution for what the backend cannot describe.
 */
export type JdbcDialectContribution = {
  /** The backend dialect's id (`JdbcDialectMetadata.id`). */
  dialectId: string;
  /**
   * A hand-written connection form, replacing the one rendered from the backend fields. For forms the fields cannot
   * describe, such as a file picker with its own logic. Provide `subtitle` and `validate` with it.
   */
  ConnectionForm?: ComponentType<JdbcDialectConnectionFormProps>;
  /** The line under a connection's name in the connections list. Default: derived from the backend fields (`host:port/database`, or the first required field). */
  subtitle?: (properties: Record<string, unknown>) => string;
  /** Problems with a connection's properties; any problem marks it invalid. Default: the backend's required fields that are empty. */
  validate?: (properties: Record<string, unknown>) => string[];
  /**
   * The dialect's backend supports estimated and actual query plans (`JdbcDialect.queryPlanExecutor()`). Turns on
   * Estimated Plan and the Actual Plan toggle for its files; core sends the intent `plan.estimated` or `plan.actual`.
   */
  supportsQueryPlan?: boolean;
};

export type JdbcDialectRegistry = {
  /** Registers the dialect's frontend additions. At most one per dialect; a later registration replaces an earlier one. */
  registerDialect: (contribution: JdbcDialectContribution) => Disposable;
};
