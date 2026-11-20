import type { Column, ColumnType, OutputContext, ResultSet } from "@queryeer/api/queryengine/OutputExtension";
import type { QueryResultFormatter, ResultFileWriter } from "../core.queryengine/QueryOutputFormatRegistry";

export type { QueryResultFormatter, ResultFileWriter };

export type TextOutputFormatId = "plain" | "json" | "csv";

/** @deprecated Use QueryResultFormatter. */
export type TextOutputFormatter = QueryResultFormatter;

function stringifyCell(cell: unknown): string {
  if (cell === null || cell === undefined) return "NULL";
  if (isLargeValueCell(cell)) return cell.preview;
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

function isLargeValueCell(value: unknown): value is { kind: "largeValue"; preview: string } {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === "largeValue"
    && typeof (value as { preview?: unknown }).preview === "string";
}

function toJsonCell(cell: unknown, columnType: ColumnType): unknown {
  if (cell === undefined || cell === null) return null;
  if (isLargeValueCell(cell)) return cell.preview;
  const trimmedCell = typeof cell === "string" ? cell.trimStart() : "";
  const isComplexType = columnType === "array" || columnType === "object" || columnType === "table";
  const isDynamicComplexValue = columnType === "any" && (trimmedCell.startsWith("[") || trimmedCell.startsWith("{"));
  if (typeof cell === "string" && (isComplexType || isDynamicComplexValue)) {
    try {
      return JSON.parse(cell);
    } catch {
      return cell;
    }
  }
  return cell;
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

function createPlainFileWriter(): ResultFileWriter {
  let started = false;
  return {
    beginResultSet: (set) => {
      const separator = started ? "\n\n" : "";
      started = true;
      return `${separator}Result set ${set.resultSetIndex + 1}\n${set.columns.map((col) => col.name).join(" | ")}`;
    },
    writeRows: (rows) => rows.map((row) => `\n${row.map((cell) => stringifyCell(cell)).join(" | ")}`).join(""),
    end: () => ""
  };
}

/** Formats complete result sets in one go through the formatter's incremental writer. */
export function formatFileWithWriter(writer: ResultFileWriter, resultSets: ResultSet[]): string {
  const parts: string[] = [];
  for (const set of resultSets) {
    parts.push(writer.beginResultSet({ resultSetIndex: set.resultSetIndex, columns: set.schema.columns }));
    parts.push(writer.writeRows(set.rows));
  }
  parts.push(writer.end());
  return parts.join("");
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
      Object.fromEntries(set.schema.columns.map((col, i) => [col.name, toJsonCell(row[i], col.type)]))
    )
  }));
  return JSON.stringify(sets, null, 2).split("\n");
}

const JSON_ROW_INDENT = "      ";

/** Produces the same text as JSON.stringify([{ resultSetIndex, rows }, ...], null, 2), piece by piece. */
function createJsonFileWriter(): ResultFileWriter {
  let setCount = 0;
  let rowCount = 0;
  let columns: Column[] = [];
  const closeSet = (): string => (rowCount === 0 ? "[]" : "\n    ]") + "\n  }";
  return {
    beginResultSet: (set) => {
      const prefix = setCount === 0 ? "[\n" : `${closeSet()},\n`;
      setCount++;
      rowCount = 0;
      columns = set.columns;
      return `${prefix}  {\n    "resultSetIndex": ${JSON.stringify(set.resultSetIndex)},\n    "rows": `;
    },
    writeRows: (rows) => rows.map((row) => {
      const value = Object.fromEntries(columns.map((col, i) => [col.name, toJsonCell(row[i], col.type)]));
      const text = JSON.stringify(value, null, 2).split("\n").map((line) => JSON_ROW_INDENT + line).join("\n");
      return `${rowCount++ === 0 ? "[\n" : ",\n"}${text}`;
    }).join(""),
    end: () => (setCount === 0 ? "[]" : `${closeSet()}\n]`)
  };
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

function createCsvFileWriter(): ResultFileWriter {
  let started = false;
  return {
    beginResultSet: (set) => {
      const separator = started ? "\n" : "";
      started = true;
      return separator + set.columns.map((col) => escapeCsv(col.name)).join(",");
    },
    writeRows: (rows) => rows.map((row) => `\n${row.map((cell) => escapeCsv(stringifyCell(cell))).join(",")}`).join(""),
    end: () => ""
  };
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
  return (context.output ?? []).map((msg) => {
    if (msg.severity === "error") {
      return `${ANSI_RED}${withLocationSuffix(`Error: ${msg.message}`, context.fileId, msg.line, msg.column)}${ANSI_RESET}`;
    }
    const message = msg.severity === "warning" ? `Warning: ${msg.message}` : msg.message;
    return withLocationSuffix(message, context.fileId, msg.line, msg.column);
  });
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
    formatFile: (resultSets) => formatFileWithWriter(createPlainFileWriter(), resultSets),
    createFileWriter: createPlainFileWriter
  },
  {
    id: "json",
    label: "JSON",
    format: (context) => formatRowSets(context, formatRowsJson),
    formatFile: (resultSets) => formatFileWithWriter(createJsonFileWriter(), resultSets),
    createFileWriter: createJsonFileWriter
  },
  {
    id: "csv",
    label: "CSV",
    format: (context) => formatRowSets(context, formatRowsCsv),
    formatFile: (resultSets) => formatFileWithWriter(createCsvFileWriter(), resultSets),
    createFileWriter: createCsvFileWriter
  }
];

export function resolveTextOutputFormatter(id: string): QueryResultFormatter {
  return TEXT_OUTPUT_FORMATTERS.find((f) => f.id === id) ?? TEXT_OUTPUT_FORMATTERS[0];
}
