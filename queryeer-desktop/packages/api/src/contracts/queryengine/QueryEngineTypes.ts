import type { Column } from "./OutputExtension.js";
import type { QueryExecuteOptions } from "../backend/Types.js";

export type CollectedResultSet = {
  schema: { columns: Column[] };
  rows: unknown[][];
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
};
