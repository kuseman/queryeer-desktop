import type { OutputSeverity, QueryOutputArtifact } from "../backend/Types.js";
import type { ReactNode } from "react";

export type ExecutionState = "idle" | "running" | "completed" | "failed" | "cancelled";

export type ColumnType =
  | "string"
  | "boolean"
  | "int"
  | "long"
  | "decimal"
  | "float"
  | "double"
  | "datetime"
  | "datetimeoffset"
  | "object"
  | "array"
  | "table"
  | "any"
  | "null";

export type Column = { name: string; type: ColumnType };

export type ResultSet = {
  resultSetIndex: number;
  schema: { columns: Column[] };
  rows: unknown[][];
  /**
   * Optional metadata key/value pairs describing this result set
   * (e.g. connection title, database name).
   */
  metadata?: Record<string, string>;
  /**
   * True once in-memory rows hit DEFAULT_OUTPUT_LIMITS.maxRows.
   * All rows beyond the limit are streamed to exportPath instead of held in memory.
   */
  rowLimitExceeded: boolean;
  /**
   * Absolute path to the temp file containing all rows (no cap).
   * Populated after queryengine.completed finalizes the export stream.
   * Undefined while the export stream is still open.
   */
  exportPath?: string;
};

export type OutputMessage = {
  severity: OutputSeverity;
  message: string;
  line?: number;
  column?: number;
};

export type OutputContext = {
  state: ExecutionState;
  resultSets: ResultSet[];
  /** Output messages (info, warnings, errors) displayed in text output. */
  output: OutputMessage[];
  /**
   * null     = features not yet known (query still running)
   * string[] = resolved from backend on queryengine.completed
   *
   * OutputPanel uses this to decide which ad-hoc contributors to open alongside
   * the primary contributor.
   */
  features: string[] | null;
  artifacts: QueryOutputArtifact[];
  metrics: { durationMs?: number; rowCount?: number } | null;
  error: { code: string; message: string; details?: Record<string, unknown> } | null;
  progress: { percent?: number; message?: string } | null;
  fetchedRowCount: number;
  executionStartedAtMs: number | null;
  textOutputFormat: string;
  rowsTargetPrimaryId: string | null;
  /** Identity of the file this context belongs to. Used by contributors for per-file state persistence. */
  fileId?: string;
};

export type RowChunk = {
  resultSetIndex: number;
  rows: unknown[][];
};

/**
 * Registered by an output plugin. Two modes:
 *
 * "primary" — competes for the main output surface. The highest-priority primary
 *             contributor whose capability is in context.features is selected
 *             automatically. The user can override this selection via the UI.
 *
 * "adhoc"   — appears as an execution-scoped tab when its capability appears in
 *             context.features. Not selectable as the default row output.
 */
export type OutputContributor = {
  id: string;
  /** The feature this contributor handles, e.g. "rows", "plan", "text". */
  capability: string;
  mode: "primary" | "adhoc";
  /** Only selectable primary contributors are shown in query output selector. Defaults to true for primary. */
  selectable?: boolean;
  title: string;
  /** Optional icon URL used in output tabs. */
  icon?: string;
  /** Lower number = higher priority in auto-resolution. Defaults to 100. */
  priority?: number;
  render: (context: OutputContext) => ReactNode;
  /**
   * Optional incremental hook called before the context state update on every
   * chunkRows event. Lets Ag-Grid call applyTransaction() without a full React
   * re-render. Only invoked for the currently selected primary contributor.
   */
  onChunkRows?: (chunk: RowChunk) => void;
};

export type OutputLimits = { maxRows: number };

export const DEFAULT_OUTPUT_LIMITS: OutputLimits = { maxRows: 100_000 };

export const IDLE_OUTPUT_CONTEXT: OutputContext = {
  state: "idle",
  resultSets: [],
  output: [],
  features: null,
  artifacts: [],
  metrics: null,
  error: null,
  progress: null,
  fetchedRowCount: 0,
  executionStartedAtMs: null,
  textOutputFormat: "plain",
  rowsTargetPrimaryId: null,
};
