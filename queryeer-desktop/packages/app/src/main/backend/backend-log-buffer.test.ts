import { describe, expect, it, vi } from "vitest";
import { BackendLogBuffer } from "./backend-log-buffer.js";

describe("BackendLogBuffer", () => {
  it("keeps only latest entries within limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const buffer = new BackendLogBuffer(2);
    buffer.append({ level: "info", source: "gateway", message: "first" });

    vi.setSystemTime(new Date("2026-01-01T00:00:01.000Z"));
    buffer.append({ level: "warn", source: "backend", message: "second" });

    vi.setSystemTime(new Date("2026-01-01T00:00:02.000Z"));
    buffer.append({ level: "error", source: "transport", message: "third" });

    const logs = buffer.toArray();
    expect(logs).toHaveLength(2);
    expect(logs[0].message).toBe("second");
    expect(logs[1].message).toBe("third");

    vi.useRealTimers();
  });

  it("evicts low-priority entries before warnings and errors", () => {
    const buffer = new BackendLogBuffer(3);
    buffer.append({ level: "error", source: "backend", message: "boom" });
    buffer.append({ level: "warn", source: "backend", message: "careful" });
    for (let i = 0; i < 10; i += 1) {
      buffer.append({ level: "debug", source: "gateway", message: `debug-${i}` });
    }

    expect(buffer.toArray().map((entry) => entry.message)).toEqual(["boom", "careful", "debug-9"]);
  });

  it("evicts the oldest entry when all entries are high priority", () => {
    const buffer = new BackendLogBuffer(2);
    buffer.append({ level: "error", source: "backend", message: "e1" });
    buffer.append({ level: "error", source: "backend", message: "e2" });
    buffer.append({ level: "warn", source: "backend", message: "w3" });

    expect(buffer.toArray().map((entry) => entry.message)).toEqual(["e2", "w3"]);
  });

  it("removes only entries of the given level", () => {
    const buffer = new BackendLogBuffer(10);
    buffer.append({ level: "trace", source: "transport", message: "t1" });
    buffer.append({ level: "error", source: "backend", message: "e1" });
    buffer.append({ level: "trace", source: "transport", message: "t2" });
    buffer.append({ level: "debug", source: "gateway", message: "d1" });

    buffer.removeLevel("trace");

    expect(buffer.toArray().map((entry) => entry.message)).toEqual(["e1", "d1"]);
  });

  it("returns a copy from toArray", () => {
    const buffer = new BackendLogBuffer(3);
    buffer.append({ level: "info", source: "gateway", message: "hello" });

    const snapshot = buffer.toArray();
    snapshot.push({
      timestamp: "2026-01-01T00:00:00.000Z",
      level: "error",
      source: "backend",
      message: "mutated"
    });

    expect(buffer.toArray()).toHaveLength(1);
  });
});
