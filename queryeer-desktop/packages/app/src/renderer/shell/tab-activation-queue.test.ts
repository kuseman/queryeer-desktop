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

  it("selects right neighbor when queue is empty and previousOpenFileIds is provided", () => {
    const result = resolveNextActiveTab({
      queue: [],
      openFileIds: ["a", "c", "d"],
      excludeFileId: "b",
      previousOpenFileIds: ["a", "b", "c", "d"]
    });

    expect(result.nextActiveFileId).toBe("c");
    expect(result.nextQueue).toEqual([]);
  });

  it("selects left neighbor when right neighbor is absent and queue is empty", () => {
    const result = resolveNextActiveTab({
      queue: [],
      openFileIds: ["a", "b"],
      excludeFileId: "c",
      previousOpenFileIds: ["a", "b", "c"]
    });

    expect(result.nextActiveFileId).toBe("b");
    expect(result.nextQueue).toEqual([]);
  });

  it("selects left neighbor when closing the first tab and queue is empty", () => {
    const result = resolveNextActiveTab({
      queue: [],
      openFileIds: ["b", "c"],
      excludeFileId: "a",
      previousOpenFileIds: ["a", "b", "c"]
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

  it("uses spatial fallback via previousOpenFileIds when activationQueue is empty", () => {
    const result = resolveActiveFileAfterRegistryUpdate({
      previousActiveFileId: "b",
      previousOpenFileIds: ["a", "b", "c", "d"],
      nextOpenFileIds: ["a", "c", "d"],
      addedFileIds: [],
      activationQueue: []
    });

    expect(result.nextActiveFileId).toBe("c");
    expect(result.nextQueue).toEqual([]);
  });

  it("inserts untitled after active tab when active is the last tab", () => {
    const result = resolveOpenFileIds({
      previousOpenFileIds: ["a", "b"],
      nextFiles: [
        { fileId: "a", uri: "file:///a.sql" },
        { fileId: "b", uri: "file:///b.sql" },
        { fileId: "u1", uri: "untitled:Untitled1.sql" }
      ],
      openNewFilesLast: false,
      activeFileId: "b",
      activationQueue: ["a", "b"]
    });

    expect(result.nextOpenFileIds).toEqual(["a", "b", "u1"]);
    expect(result.addedFileIds).toEqual(["u1"]);
  });

  it("inserts untitled after activation-queue anchor when active tab is missing", () => {
    const result = resolveOpenFileIds({
      previousOpenFileIds: ["a", "b", "c"],
      nextFiles: [
        { fileId: "a", uri: "file:///a.sql" },
        { fileId: "b", uri: "file:///b.sql" },
        { fileId: "u1", uri: "untitled:Untitled1.sql" }
      ],
      openNewFilesLast: false,
      activeFileId: "c",
      activationQueue: ["a", "b"]
    });

    // activationQueue reversed is [b, a]; b is the MRU anchor at index 1
    expect(result.nextOpenFileIds).toEqual(["a", "b", "u1"]);
    expect(result.addedFileIds).toEqual(["u1"]);
  });

  it("appends untitled when both active and activationQueue are empty", () => {
    const result = resolveOpenFileIds({
      previousOpenFileIds: ["a", "b"],
      nextFiles: [
        { fileId: "a", uri: "file:///a.sql" },
        { fileId: "b", uri: "file:///b.sql" },
        { fileId: "u1", uri: "untitled:Untitled1.sql" }
      ],
      openNewFilesLast: false,
      activeFileId: null,
      activationQueue: []
    });

    expect(result.nextOpenFileIds).toEqual(["a", "b", "u1"]);
    expect(result.addedFileIds).toEqual(["u1"]);
  });

  it("selects added file as active when a file is added", () => {
    const result = resolveActiveFileAfterRegistryUpdate({
      previousActiveFileId: "a",
      nextOpenFileIds: ["a", "u1"],
      addedFileIds: ["u1"],
      activationQueue: ["a"]
    });

    expect(result.nextActiveFileId).toBe("u1");
    expect(result.nextQueue).toEqual(["a"]);
  });

  it("inserts regular file after active tab when openNewFilesLast is disabled", () => {
    const result = resolveOpenFileIds({
      previousOpenFileIds: ["a", "b"],
      nextFiles: [
        { fileId: "a", uri: "file:///a.sql" },
        { fileId: "b", uri: "file:///b.sql" },
        { fileId: "c", uri: "file:///c.sql" }
      ],
      openNewFilesLast: false,
      activeFileId: "a",
      activationQueue: ["a", "b"]
    });

    expect(result.nextOpenFileIds).toEqual(["a", "c", "b"]);
    expect(result.addedFileIds).toEqual(["c"]);
  });
});
