import type { OutputContext, ResultSet } from "../../contracts/queryengine/OutputExtension";

export type TextOutputFormatId = "plain" | "json" | "csv";

export type QueryResultFormatter = {
  id: string;
  label: string;
  /** Format for text display — full context with status and output lines. */
  format: (context: OutputContext) => string[];
  /** Format completed result sets as file content string. */
  formatFile: (resultSets: ResultSet[]) => string;
};

/** @deprecated Use QueryResultFormatter. */
export type TextOutputFormatter = QueryResultFormatter;

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

// ---- Plain format ----

const FORMAT_TARGET_TEXT = "core.queryengine.output.text";
const FORMAT_TARGET_FILE = "core.queryengine.output.file";

function formatRowsPlain(context: OutputContext): string[] {
  if (context.rowsTargetPrimaryId !== FORMAT_TARGET_TEXT && context.rowsTargetPrimaryId !== FORMAT_TARGET_FILE) {
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

function plainFileContent(resultSets: ResultSet[]): string {
  return resultSets.map((set) => {
    const header = set.schema.columns.map((col) => col.name).join(" | ");
    const rows = set.rows.map((row) => row.map((cell) => stringifyCell(cell)).join(" | "));
    return [`Result set ${set.resultSetIndex + 1}`, header, ...rows].join("\n");
  }).join("\n\n");
}

function formatRowSets(context: OutputContext, rowsFormatter: (context: OutputContext) => string[]): string[] {
  const outputLines = getOutputLines(context);
  const statusLines = getStatusLines(context);
  if (context.state === "failed") {
    return outputLines.length > 0 ? [...outputLines, "", ...statusLines] : statusLines;
  }
  const rowLines = rowsFormatter(context);
  const allLines = outputLines.length > 0 ? [...outputLines, ""] : [];
  if (context.state === "idle" && rowLines.length > 0) {
    return [...allLines, ...rowLines];
  }
  if (statusLines.length === 0) {
    return [...allLines, ...rowLines];
  }
  if (rowLines.length === 0) {
    return [...allLines, ...statusLines];
  }
  return [...allLines, ...statusLines, "", ...rowLines];
}

// ---- JSON format ----

function formatRowsJson(context: OutputContext): string[] {
  if (context.rowsTargetPrimaryId !== FORMAT_TARGET_TEXT && context.rowsTargetPrimaryId !== FORMAT_TARGET_FILE) {
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

function jsonFileContent(resultSets: ResultSet[]): string {
  const sets = resultSets.map((set) => ({
    resultSetIndex: set.resultSetIndex,
    rows: set.rows.map((row) =>
      Object.fromEntries(set.schema.columns.map((col, i) => [col.name, row[i] ?? null]))
    )
  }));
  return JSON.stringify(sets, null, 2);
}

// ---- CSV format ----

function formatRowsCsv(context: OutputContext): string[] {
  if (context.rowsTargetPrimaryId !== FORMAT_TARGET_TEXT && context.rowsTargetPrimaryId !== FORMAT_TARGET_FILE) {
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

function csvFileContent(resultSets: ResultSet[]): string {
  return resultSets.map((set) => {
    const header = set.schema.columns.map((col) => escapeCsv(col.name)).join(",");
    const rows = set.rows.map((row) => row.map((cell) => escapeCsv(stringifyCell(cell))).join(","));
    return [header, ...rows].join("\n");
  }).join("\n");
}

const ANSI_RED = "\x1b[31m";
const ANSI_RESET = "\x1b[0m";

function toEditorLink(fileId: string | undefined, line: number | undefined, column: number | undefined): string | null {
  if (!fileId || line === undefined) {
    return null;
  }
  const query = new URLSearchParams({
    fileId,
    line: String(line),
    column: String(column ?? 1)
  });
  return `editor://open?${query.toString()}`;
}

function withLocationSuffix(message: string, fileId: string | undefined, line: number | undefined, column: number | undefined): string {
  const hasLocation = Boolean(toEditorLink(fileId, line, column));
  if (!hasLocation) {
    return message;
  }
  const label = `line ${line}, col ${column ?? 1}`;
  return `${message} ([${label}])`;
}

function getOutputLines(context: OutputContext): string[] {
  return (context.output ?? []).map((msg) =>
    msg.severity === "error"
      ? `${ANSI_RED}${withLocationSuffix(`Error: ${msg.message}`, context.fileId, msg.line, msg.column)}${ANSI_RESET}`
      : withLocationSuffix(msg.message, context.fileId, msg.line, msg.column)
  );
}

function getStatusLines(context: OutputContext): string[] {
  const lines: string[] = [];
  if (context.state === "failed" && context.error) {
    const details = context.error.details;
    const line = typeof details?.line === "number" ? details.line : undefined;
    const column = typeof details?.column === "number" ? details.column : undefined;
    lines.push(`${ANSI_RED}${withLocationSuffix(context.error.message, context.fileId, line, column)}${ANSI_RESET}`);
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

export const TEXT_OUTPUT_FORMATTERS: QueryResultFormatter[] = [
  {
    id: "plain",
    label: "Plain",
    format: (context) => formatRowSets(context, formatRowsPlain),
    formatFile: plainFileContent
  },
  {
    id: "json",
    label: "JSON",
    format: (context) => formatRowSets(context, formatRowsJson),
    formatFile: jsonFileContent
  },
  {
    id: "csv",
    label: "CSV",
    format: (context) => formatRowSets(context, formatRowsCsv),
    formatFile: csvFileContent
  }
];

export function resolveTextOutputFormatter(id: string): QueryResultFormatter {
  return TEXT_OUTPUT_FORMATTERS.find((f) => f.id === id) ?? TEXT_OUTPUT_FORMATTERS[0];
}
