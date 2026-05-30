import { describe, expect, it } from "vitest";
import { getFlowStateStore } from "./flow-state";
import { parseQflowDocument } from "./qflow-parser";
import type { FlowExecutionResult } from "./types";

describe("flow state store", () => {
  it("maps cursor line to run-to-node mode", () => {
    const store = getFlowStateStore();
    store.clearAll();

    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: payloadbuilder.query",
      "%%",
      "select 2"
    ].join("\n"));
    store.setDocument("file-1", document);

    expect(store.runModeForCursor("file-1", 2)).toEqual({ kind: "to-node", nodeId: "first" });
    expect(store.runModeForCursor("file-1", 10)).toEqual({ kind: "to-node", nodeId: "second" });
    expect(store.runModeForCursor("missing", 2)).toBeUndefined();
  });

  it("returns stable snapshots and only updates identity on change", () => {
    const store = getFlowStateStore();
    store.clearAll();

    const emptyA = store.getSnapshot(null);
    const emptyB = store.getSnapshot(null);
    expect(emptyA).toBe(emptyB);

    const initialSnapshotA = store.getSnapshot("file-snapshot");
    const initialSnapshotB = store.getSnapshot("file-snapshot");
    expect(initialSnapshotA).toBe(initialSnapshotB);

    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));
    store.setDocument("file-snapshot", document);

    const afterDocumentSnapshotA = store.getSnapshot("file-snapshot");
    const afterDocumentSnapshotB = store.getSnapshot("file-snapshot");
    expect(afterDocumentSnapshotA).toBe(afterDocumentSnapshotB);
    expect(afterDocumentSnapshotA).not.toBe(initialSnapshotA);
    expect(afterDocumentSnapshotA.document).toBe(document);
    expect(afterDocumentSnapshotA.execution).toBeUndefined();

    store.setDocument("file-snapshot", document);
    expect(store.getSnapshot("file-snapshot")).toBe(afterDocumentSnapshotA);

    const execution: FlowExecutionResult = {
      mode: { kind: "all" },
      nodes: [],
      ctx: {},
      stoppedOnFailure: false
    };
    store.setExecution("file-snapshot", execution);

    const afterExecutionSnapshot = store.getSnapshot("file-snapshot");
    expect(afterExecutionSnapshot).not.toBe(afterDocumentSnapshotA);
    expect(afterExecutionSnapshot.document).toBe(document);
    expect(afterExecutionSnapshot.execution).toBe(execution);

    store.clearExecution("file-snapshot");
    const afterClearExecutionSnapshot = store.getSnapshot("file-snapshot");
    expect(afterClearExecutionSnapshot).not.toBe(afterExecutionSnapshot);
    expect(afterClearExecutionSnapshot.document).toBe(document);
    expect(afterClearExecutionSnapshot.execution).toBeUndefined();
  });

  it("clears all executions while preserving documents", () => {
    const store = getFlowStateStore();
    store.clearAll();

    const documentA = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));
    const documentB = parseQflowDocument([
      "%%queryeer-flow",
      "id: second",
      "type: payloadbuilder.query",
      "%%",
      "select 2"
    ].join("\n"));

    store.setDocument("file-a", documentA);
    store.setDocument("file-b", documentB);
    store.setExecution("file-a", {
      mode: { kind: "all" },
      nodes: [],
      ctx: {},
      stoppedOnFailure: false
    });
    store.setExecution("file-b", {
      mode: { kind: "all" },
      nodes: [],
      ctx: {},
      stoppedOnFailure: false
    });

    store.clearAllExecutions();

    expect(store.getSnapshot("file-a").document).toBe(documentA);
    expect(store.getSnapshot("file-b").document).toBe(documentB);
    expect(store.getSnapshot("file-a").execution).toBeUndefined();
    expect(store.getSnapshot("file-b").execution).toBeUndefined();
  });
});
