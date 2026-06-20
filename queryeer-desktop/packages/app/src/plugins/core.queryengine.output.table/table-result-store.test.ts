import { describe, expect, it, vi } from "vitest";
import { getTableResultStore } from "./table-result-store";

describe("table result store", () => {
  it("stores rows in chunks and returns ranges without requiring a single accumulated source array", () => {
    const store = getTableResultStore();
    const key = { fileId: "store-test-1", resultSetIndex: 0 };

    store.clearFile(key.fileId);
    store.appendRows(key, [[1], [2]]);
    store.appendRows(key, [[3]]);

    expect(store.getRowCount(key)).toBe(3);
    expect(store.getRowsFrom(key, 1)).toEqual([[2], [3]]);
    expect(store.getRowsRange(key, 1, 2)).toEqual([[2]]);
    expect(store.getRow(key, 2)).toEqual([3]);
  });

  it("notifies subscribers when rows are appended or cleared", () => {
    const store = getTableResultStore();
    const key = { fileId: "store-test-2", resultSetIndex: 0 };
    const listener = vi.fn();

    store.clearFile(key.fileId);
    const unsubscribe = store.subscribe(key, listener);
    store.appendRows(key, [[1]]);
    store.clearFile(key.fileId);
    unsubscribe();
    store.appendRows(key, [[2]]);

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("clears rows by output session scope without affecting other sessions", () => {
    const store = getTableResultStore();
    const leftKey = { outputSessionId: "session-left", fileId: "shared-file", resultSetIndex: 0 };
    const rightKey = { outputSessionId: "session-right", fileId: "shared-file", resultSetIndex: 0 };

    store.clearAll();
    store.appendRows(leftKey, [[1], [2]]);
    store.appendRows(rightKey, [[10]]);

    store.clear({ outputSessionId: "session-left", fileId: "shared-file" });

    expect(store.getRowCount(leftKey)).toBe(0);
    expect(store.getRows(leftKey)).toEqual([]);
    expect(store.getRowCount(rightKey)).toBe(1);
    expect(store.getRows(rightKey)).toEqual([[10]]);
  });
});
