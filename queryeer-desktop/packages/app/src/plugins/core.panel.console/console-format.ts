import type { BackendLogLevel } from "@queryeer/api/backend";
import type { ConsoleLogEntry } from "./console-state";

const LOG_LEVEL_ORDER: Record<BackendLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
};

const LOG_LEVEL_COLOR: Record<BackendLogLevel, string> = {
  trace: "\x1b[2m",    // dim — least prominent
  debug: "\x1b[36m",   // cyan — clearly above trace, below info
  info:  "",           // terminal default
  warn:  "\x1b[33m",   // yellow
  error: "\x1b[91m"    // bright red
};

const ANSI_RESET = "\x1b[0m";

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}

function formatLocalIsoDateTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  const milliseconds = pad3(date.getMilliseconds());

  const offsetMinutes = -date.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? "+" : "-";
  const offsetHours = pad2(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetRemainderMinutes = pad2(Math.abs(offsetMinutes) % 60);
  const offset = `${offsetSign}${offsetHours}:${offsetRemainderMinutes}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offset}`;
}

export function formatConsoleLogLines(entries: readonly ConsoleLogEntry[], levelFilter: BackendLogLevel): string[] {
  const threshold = LOG_LEVEL_ORDER[levelFilter];
  return entries
    .filter((entry) => LOG_LEVEL_ORDER[entry.level] >= threshold)
    // Backend entries arrive via polling, so order by timestamp to interleave them with frontend entries
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
    .map((entry) => {
      const time = formatLocalIsoDateTime(entry.timestamp);
      const color = LOG_LEVEL_COLOR[entry.level];
      const source = entry.origin === "frontend" ? `FRONTEND:${entry.source}` : entry.source;
      const line = `[${time}] [${entry.level.toUpperCase()}] [${source}] ${entry.message}`;
      return color ? `${color}${line}${ANSI_RESET}` : line;
    });
}
