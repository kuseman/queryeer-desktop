import { describe, expect, it } from "vitest";
import {
  recordTabActivation,
  resolveActiveFileAfterRegistryUpdate,
  resolveNextActiveTab,
  resolveOpenFileIds
} from "./tab-activation-queue";

describe("tab activation queue", () => {
  it("moves active tab to end on activation", () => {
    const result = recordTabActivation(["a", "b", "c"], "b");
    expect(result).toEqual(["a", "c", "b"]);
  });

  it("ignores null activation", () => {
    const result = recordTabActivation(["a"], null);
    expect(result).toEqual(["a"]);
  });

  it("resolves previous activated tab when closing active tab", () => {
    const result = resolveNextActiveTab({
      queue: ["a", "c", "b"],
      openFileIds: ["a", "c"],
      excludeFileId: "b"
    });

    expect(result.nextActiveFileId).toBe("c");
    expect(result.nextQueue).toEqual(["a", "c"]);
  });

  it("falls back to last open tab when queue has no open ids", () => {
    const result = resolveNextActiveTab({
      queue: ["x"],
      openFileIds: ["a", "b"]
    });

    expect(result.nextActiveFileId).toBe("b");
    expect(result.nextQueue).toEqual([]);
  });

  it("places untitled after MRU anchor when active tab is missing", () => {
    const result = resolveOpenFileIds({
      previousOpenFileIds: ["a", "b"],
      nextFiles: [
        { fileId: "a", uri: "file:///a.sql" },
        { fileId: "b", uri: "file:///b.sql" },
        { fileId: "u1", uri: "untitled:Untitled1.sql" }
      ],
      openNewFilesLast: false,
      activeFileId: null,
      activationQueue: ["a", "b"]
    });

    expect(result.nextOpenFileIds).toEqual(["a", "b", "u1"]);
    expect(result.addedFileIds).toEqual(["u1"]);
  });

  it("inserts untitled after active tab when openNewFilesLast is disabled", () => {
    const result = resolveOpenFileIds({
      previousOpenFileIds: ["a", "b"],
      nextFiles: [
        { fileId: "a", uri: "file:///a.sql" },
        { fileId: "b", uri: "file:///b.sql" },
        { fileId: "u1", uri: "untitled:Untitled1.sql" }
      ],
      openNewFilesLast: false,
      activeFileId: "a",
      activationQueue: ["a", "b"]
    });

    expect(result.nextOpenFileIds).toEqual(["a", "u1", "b"]);
    expect(result.addedFileIds).toEqual(["u1"]);
  });

  it("resolves previous active tab when active tab disappears without additions", () => {
    const result = resolveActiveFileAfterRegistryUpdate({
      previousActiveFileId: "b",
      nextOpenFileIds: ["a", "c"],
      addedFileIds: [],
      activationQueue: ["a", "c", "b"]
    });

    expect(result.nextActiveFileId).toBe("c");
    expect(result.nextQueue).toEqual(["a", "c"]);
  });
});
