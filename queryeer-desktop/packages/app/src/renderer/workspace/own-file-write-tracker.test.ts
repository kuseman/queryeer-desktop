import { describe, expect, it, vi } from "vitest";
import { OwnFileWriteTracker } from "./own-file-write-tracker";

describe("OwnFileWriteTracker", () => {
  it("matches only the latest successful content written by Queryeer", async () => {
    const tracker = new OwnFileWriteTracker();
    await tracker.write("file:///a.txt", "saved", async () => ({ success: true }));

    await expect(tracker.matchesCurrentDiskContent("file:///a.txt", async () => ({
      success: true,
      content: "saved"
    }))).resolves.toBe(true);
    await expect(tracker.matchesCurrentDiskContent("file:///a.txt", async () => ({
      success: true,
      content: "external"
    }))).resolves.toBe(false);
  });

  it("serializes overlapping writes to the same uri", async () => {
    const tracker = new OwnFileWriteTracker();
    let finishFirst: (() => void) | undefined;
    const secondWriter = vi.fn(async () => ({ success: true }));

    const first = tracker.write("file:///a.txt", "first", () => new Promise((resolve) => {
      finishFirst = () => resolve({ success: true });
    }));
    const second = tracker.write("file:///a.txt", "second", secondWriter);
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));

    expect(secondWriter).not.toHaveBeenCalled();
    finishFirst?.();
    await first;
    await second;

    expect(secondWriter).toHaveBeenCalledOnce();
    await expect(tracker.matchesCurrentDiskContent("file:///a.txt", async () => ({
      success: true,
      content: "second"
    }))).resolves.toBe(true);
  });

  it("does not acknowledge failed writes", async () => {
    const tracker = new OwnFileWriteTracker();
    await tracker.write("file:///a.txt", "failed", async () => ({ success: false }));

    await expect(tracker.matchesCurrentDiskContent("file:///a.txt", async () => ({
      success: true,
      content: "failed"
    }))).resolves.toBe(false);
  });

  it("waits for an in-flight write before classifying a watcher event", async () => {
    const tracker = new OwnFileWriteTracker();
    let finishWrite: (() => void) | undefined;
    const reader = vi.fn(async () => ({ success: true, content: "saved" }));
    const write = tracker.write("file:///a.txt", "saved", () => new Promise((resolve) => {
      finishWrite = () => resolve({ success: true });
    }));
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));

    const matches = tracker.matchesCurrentDiskContent("file:///a.txt", reader);
    await Promise.resolve();
    expect(reader).not.toHaveBeenCalled();

    finishWrite?.();
    await write;
    await expect(matches).resolves.toBe(true);
    expect(reader).toHaveBeenCalledOnce();
  });
});
