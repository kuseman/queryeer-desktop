import { describe, expect, it } from "vitest";
import { formatConsoleLogLines } from "./console-format";
import type { ConsoleLogEntry } from "./console-state";

function entry(partial: Partial<ConsoleLogEntry> & Pick<ConsoleLogEntry, "level" | "message">): ConsoleLogEntry {
  return { origin: "backend", timestamp: "2026-01-01T00:00:00.000Z", source: "backend", ...partial };
}

// eslint-disable-next-line no-control-regex
const stripAnsi = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");

describe("formatConsoleLogLines", () => {
  it("filters entries below the selected level", () => {
    const entries = [entry({ level: "debug", message: "dbg" }), entry({ level: "error", message: "err" })];

    expect(formatConsoleLogLines(entries, "error").map(stripAnsi)).toEqual([
      expect.stringContaining("[ERROR] [backend] err")
    ]);
  });

  it("shows previously hidden entries when the level is lowered", () => {
    // Regression: lowering the filter used to show nothing for entries already filtered out
    const entries = [entry({ level: "info", message: "info line" }), entry({ level: "error", message: "err" })];

    expect(formatConsoleLogLines(entries, "error")).toHaveLength(1);
    expect(formatConsoleLogLines(entries, "info")).toHaveLength(2);
  });

  it("orders entries by timestamp and labels frontend entries", () => {
    const entries = [
      entry({ level: "info", message: "backend later", timestamp: "2026-01-01T00:00:02.000Z" }),
      entry({ origin: "frontend", source: "Mod", level: "info", message: "frontend earlier", timestamp: "2026-01-01T00:00:01.000Z" })
    ];

    const lines = formatConsoleLogLines(entries, "info").map(stripAnsi);

    expect(lines[0]).toContain("[FRONTEND:Mod] frontend earlier");
    expect(lines[1]).toContain("[backend] backend later");
  });

  it("does not mutate the input entries", () => {
    const entries = [
      entry({ level: "info", message: "b", timestamp: "2026-01-01T00:00:02.000Z" }),
      entry({ level: "info", message: "a", timestamp: "2026-01-01T00:00:01.000Z" })
    ];

    formatConsoleLogLines(entries, "info");

    expect(entries.map((e) => e.message)).toEqual(["b", "a"]);
  });
});
