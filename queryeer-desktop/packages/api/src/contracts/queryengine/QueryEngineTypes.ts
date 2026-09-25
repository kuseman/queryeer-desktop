import type { Column } from "./OutputExtension.js";
import type { QueryExecuteOptions, QueryResultCell } from "../backend/Types.js";

export type CollectedResultSet = {
  schema: { columns: Column[] };
  rows: QueryResultCell[][];
};

export type CollectedResults = {
  resultSets: CollectedResultSet[];
};

export type ExecuteRequestOptions = {
  textOverride?: string;
  outputIdOverride?: string;
  formatOverride?: string;
  optionsOverride?: QueryExecuteOptions;
  fileIdOverride?: string;
  targetOutputSessionId?: string;
  targetEditorGroupId?: string;
  /** Execute the whole document even when the editor has a selection. */
  useSelection?: boolean;
  /** Marks a renderer-owned recurring execution. Never sent to the backend. */
  scheduled?: boolean;
};

export type QueryScheduleState = {
  intervalSeconds: number;
  paused: boolean;
  pauseReason?: string;
  nextRunAtMs?: number;
  consecutiveInfrastructureFailures: number;
};

export type ScheduleRequestOptions = {
  intervalSeconds: number;
  fileIdOverride?: string;
  targetOutputSessionId?: string;
  targetEditorGroupId?: string;
};

export type CancelRequestOptions = {
  fileIdOverride?: string;
  targetOutputSessionId?: string;
  targetEditorGroupId?: string;
};
