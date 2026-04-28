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

function formatRowsJson(context: OutputContext): string[] {
  const sets = context.resultSets.map((set) => ({
    resultSetIndex: set.resultSetIndex,
    rows: set.rows.map((row) =>
      Object.fromEntries(set.schema.columns.map((col, i) => [col.name, row[i] ?? null]))
    )
  }));
  return JSON.stringify(sets, null, 2).split("\n");
}

function formatRowsCsv(context: OutputContext): string[] {
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
  if (context.state === "failed" && context.error) {
    return [`[${context.error.code}]`, context.error.message];
  }
  if (context.state === "completed") {
    if ((context.metrics?.rowCount ?? 0) > 0) {
      return [];
    }
    return [
      "No rows returned.",
      context.metrics?.durationMs !== undefined ? `Duration: ${context.metrics.durationMs}ms` : ""
    ].filter(Boolean);
  }
  if (context.state === "cancelled") return ["Query cancelled."];
  if (context.state === "idle") return ["Press F5 or click Run to execute a query."];
  if (context.state === "running") {
    return [context.progress?.message ?? "Running query..."];
  }
  return [];
}

export const TEXT_OUTPUT_FORMATTERS: TextOutputFormatter[] = [
  {
    id: "plain",
    label: "Plain",
    format: (context) =>
      context.resultSets.length > 0 ? formatRowsPlain(context) : getStatusLines(context)
  },
  {
    id: "json",
    label: "JSON",
    format: (context) =>
      context.resultSets.length > 0 ? formatRowsJson(context) : getStatusLines(context)
  },
  {
    id: "csv",
    label: "CSV",
    format: (context) =>
      context.resultSets.length > 0 ? formatRowsCsv(context) : getStatusLines(context)
  }
];

export function resolveTextOutputFormatter(id: TextOutputFormatId): TextOutputFormatter {
  return TEXT_OUTPUT_FORMATTERS.find((f) => f.id === id) ?? TEXT_OUTPUT_FORMATTERS[0];
}
