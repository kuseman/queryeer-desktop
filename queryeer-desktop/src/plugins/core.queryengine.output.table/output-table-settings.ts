import { getCoreSettingsService } from "../core.settings/service";

export const OUTPUT_TABLE_VIEW_MODE_SETTING_ID = "core.queryengine.output.table.resultSets.viewMode";
export const OUTPUT_TABLE_STACKED_MAX_ROWS_SETTING_ID = "core.queryengine.output.table.resultSets.stackedMaxRows";

export type OutputTableResultSetsViewMode = "tabs" | "stacked";

export type OutputTableSettings = {
  viewMode: OutputTableResultSetsViewMode;
  stackedMaxRows: number;
};

export const DEFAULT_OUTPUT_TABLE_SETTINGS: OutputTableSettings = {
  viewMode: "tabs",
  stackedMaxRows: 500,
};

export function coerceOutputTableSettings(values: {
  viewMode?: unknown;
  stackedMaxRows?: unknown;
}): OutputTableSettings {
  const viewMode = values.viewMode === "stacked" || values.viewMode === "tabs"
    ? values.viewMode
    : DEFAULT_OUTPUT_TABLE_SETTINGS.viewMode;

  const rawMaxRows = values.stackedMaxRows;
  const stackedMaxRows =
    typeof rawMaxRows === "number" && Number.isFinite(rawMaxRows)
      ? Math.max(10, Math.floor(rawMaxRows))
      : DEFAULT_OUTPUT_TABLE_SETTINGS.stackedMaxRows;

  return {
    viewMode,
    stackedMaxRows,
  };
}

export function resolveOutputTableSettings(): OutputTableSettings {
  const settings = getCoreSettingsService();
  if (!settings) {
    return DEFAULT_OUTPUT_TABLE_SETTINGS;
  }
  return coerceOutputTableSettings({
    viewMode: settings.getValue(OUTPUT_TABLE_VIEW_MODE_SETTING_ID),
    stackedMaxRows: settings.getValue(OUTPUT_TABLE_STACKED_MAX_ROWS_SETTING_ID),
  });
}
