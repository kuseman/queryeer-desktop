import { DEFAULT_OUTPUT_LIMITS } from "../../contracts/extensions/OutputExtension";
import { getCoreSettingsService } from "../core.settings/service";

export const OUTPUT_TABLE_MAX_ROWS_SETTING_ID = "core.queryengine.output.table.maxRows";

export function coerceOutputMaxRows(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_OUTPUT_LIMITS.maxRows;
  }
  if (value === -1) {
    return -1;
  }
  return Math.max(1, Math.floor(value));
}

export function resolveOutputMaxRows(): number {
  return coerceOutputMaxRows(getCoreSettingsService()?.getValue(OUTPUT_TABLE_MAX_ROWS_SETTING_ID));
}
