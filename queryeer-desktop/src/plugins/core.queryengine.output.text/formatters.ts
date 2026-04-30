import type { OutputContext } from "../../contracts/extensions/OutputExtension";

export type TextOutputFormatId = "plain" | "json" | "csv";

export type TextOutputFormatter = {
  id: TextOutputFormatId;
  label: string;
  format: (context: OutputContext) => string[];
};

function stringifyCell(cell: unknown): string {
  if (cell === null || cell === undefined) return "NULL";
  if (typeof cell === "string") return cell;
  if (typeof cell === "number" || typeof cell === "boolean" || typeof cell === "bigint") {
    return String(cell);
  }
  try {
    return JSON.stringify(cell);
  } catch {
    return String(cell);
  }
}

function escapeCsv(value: string): string {
  const escaped = value.replaceAll("\"", "\"\"");
  return `"${escaped}"`;
}

function formatRowsPlain(context: OutputContext): string[] {
  if (context.rowsTargetPrimaryId !== "core.queryengine.output.text") {
    return [];
  }
  const lines: string[] = [];
  for (const set of context.resultSets) {
    lines.push(`Result set ${set.resultSetIndex + 1}`);
    lines.push(set.schema.columns.map((col) => col.name).join(" | "));
    for (const row of set.rows) {
      lines.push(row.map((cell) => stringifyCell(cell)).join(" | "));
    }
    lines.push("");
  }
  return lines;
}

function formatRowSets(context: OutputContext, rowsFormatter: (context: OutputContext) => string[]): string[] {
  const statusLines = getStatusLines(context);
  if (context.state === "failed") {
    return statusLines;
  }
  const rowLines = rowsFormatter(context);
  if (context.state === "idle" && rowLines.length > 0) {
    return rowLines;
  }
  if (statusLines.length === 0) {
    return rowLines;
  }
  if (rowLines.length === 0) {
    return statusLines;
  }
  return [...statusLines, "", ...rowLines];
}

function formatRowsJson(context: OutputContext): string[] {
  if (context.rowsTargetPrimaryId !== "core.queryengine.output.text") {
    return [];
  }
  const sets = context.resultSets.map((set) => ({
    resultSetIndex: set.resultSetIndex,
    rows: set.rows.map((row) =>
      Object.fromEntries(set.schema.columns.map((col, i) => [col.name, row[i] ?? null]))
    )
  }));
  return JSON.stringify(sets, null, 2).split("\n");
}

function formatRowsCsv(context: OutputContext): string[] {
  if (context.rowsTargetPrimaryId !== "core.queryengine.output.text") {
    return [];
  }
  const lines: string[] = [];
  for (const set of context.resultSets) {
    lines.push(`# Result set ${set.resultSetIndex + 1}`);
    lines.push(set.schema.columns.map((col) => escapeCsv(col.name)).join(","));
    for (const row of set.rows) {
      lines.push(row.map((cell) => escapeCsv(stringifyCell(cell))).join(","));
    }
    lines.push("");
  }
  return lines;
}

function getStatusLines(context: OutputContext): string[] {
  const lines: string[] = [];
  if (context.state === "failed" && context.error) {
    lines.push(`[${context.error.code}]`, context.error.message);
    return lines;
  }
  if (context.state === "completed") {
    const rows = context.metrics?.rowCount ?? context.fetchedRowCount;
    if (rows > 0) {
      lines.push(`Rows fetched: ${rows}`);
      if (context.metrics?.durationMs !== undefined) {
        lines.push(`Duration: ${context.metrics.durationMs}ms`);
      }
      return lines;
    }
    return [
      "No rows returned.",
      context.metrics?.durationMs !== undefined ? `Duration: ${context.metrics.durationMs}ms` : ""
    ].filter(Boolean);
  }
  if (context.state === "cancelled") return ["Query cancelled."];
  if (context.state === "idle") return [];
  if (context.state === "running") {
    lines.push(context.progress?.message ?? "Running query...");
    lines.push(`Rows fetched: ${context.fetchedRowCount}`);
    return lines;
  }
  return [];
}

export const TEXT_OUTPUT_FORMATTERS: TextOutputFormatter[] = [
  {
    id: "plain",
    label: "Plain",
    format: (context) => formatRowSets(context, formatRowsPlain)
  },
  {
    id: "json",
    label: "JSON",
    format: (context) => formatRowSets(context, formatRowsJson)
  },
  {
    id: "csv",
    label: "CSV",
    format: (context) => formatRowSets(context, formatRowsCsv)
  }
];

export function resolveTextOutputFormatter(id: TextOutputFormatId): TextOutputFormatter {
  return TEXT_OUTPUT_FORMATTERS.find((f) => f.id === id) ?? TEXT_OUTPUT_FORMATTERS[0];
}
