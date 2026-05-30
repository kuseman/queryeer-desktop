import type { CollectedResults } from "@queryeer/api/queryengine/QueryEngineTypes.js";
import type { FlowNodeExecutionOutput } from "@queryeer/api/flow/FlowDocument.js";
import { getQueryEngineService } from "./QueryEngineService";

export async function executeQueryForFlow(params: {
  engineId: string;
  fileId: string;
  text: string;
  engineState?: unknown;
}): Promise<FlowNodeExecutionOutput> {
  const result = await getQueryEngineService().executeAndCollect({
    engineId: params.engineId,
    fileId: params.fileId,
    text: params.text,
    ...(params.engineState !== undefined ? { engineState: params.engineState } : {})
  });
  return toFlowOutput(params.text, result);
}

function toFlowOutput(action: string, result: CollectedResults): FlowNodeExecutionOutput {
  const firstResultSet = result.resultSets[0];
  const rows = firstResultSet
    ? firstResultSet.rows.map((row) => toObjectRow(firstResultSet.schema.columns, row))
    : [];
  const rowCount = result.resultSets.reduce((sum, resultSet) => sum + resultSet.rows.length, 0);

  return {
    rowsAffected: rowCount,
    rows,
    preview: action.slice(0, 140)
  };
}

function toObjectRow(
  columns: Array<{ name: string }>,
  values: unknown[]
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (let index = 0; index < values.length; index += 1) {
    const columnName = columns[index]?.name?.trim() || `column_${index + 1}`;
    row[columnName] = values[index];
  }
  return row;
}
