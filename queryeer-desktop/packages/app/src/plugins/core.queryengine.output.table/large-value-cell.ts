import type { QueryLargeValueCell } from "@queryeer/api/backend/Types.js";

export function isLargeValueCell(value: unknown): value is QueryLargeValueCell {
  return isRecord(value)
    && value.kind === "largeValue"
    && typeof value.ref === "string"
    && typeof value.preview === "string"
    && typeof value.byteLength === "number";
}

export function cellValueToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isLargeValueCell(value)) return value.preview;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function formatLargeValueTitle(value: QueryLargeValueCell): string {
  const type = value.logicalType || "value";
  return `Large ${type} value (${formatBytes(value.byteLength)})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} TB`;
}
