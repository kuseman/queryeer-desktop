import { describe, expect, it, vi } from "vitest";
import { BackendLogBuffer } from "./backend-log-buffer";

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
