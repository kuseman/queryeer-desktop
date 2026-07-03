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
};
