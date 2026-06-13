import { describe, expect, it } from "vitest";
import {
  closeFileInGroup,
  createEditorWorkbenchState,
  createPersistedEditorLayout,
  getActiveWorkbenchFileId,
  isFileReferenced,
  listWorkbenchFileIds,
  openFileToSide,
  resizeAdjacentEditorGroups,
  restoreEditorWorkbenchStateFromSnapshot,
  selectFileInGroup,
  splitActiveGroupRight,
  syncWorkbenchWithFiles
} from "./editor-workbench-state";

describe("editor workbench state", () => {
  it("creates one group from existing open files", () => {
    const state = createEditorWorkbenchState(["a", "b"], "a");

    expect(state.groups).toHaveLength(1);
    expect(state.groups[0]).toMatchObject({
      id: "editor-group-1",
      fileIds: ["a", "b"],
      activeFileId: "a"
    });
    expect(getActiveWorkbenchFileId(state)).toBe("a");
  });

  it("duplicates the active tab when splitting right", () => {
    const state = createEditorWorkbenchState(["query", "other"], "query");

    const next = splitActiveGroupRight(state);

    expect(next.groups.map((group) => group.fileIds)).toEqual([["query", "other"], ["query"]]);
    expect(next.groups[1].activeFileId).toBe("query");
    expect(next.activeGroupId).toBe(next.groups[1].id);
    expect(isFileReferenced(next, "query")).toBe(true);
  });

  it("opens a file to the group on the right and focuses it", () => {
    const state = createEditorWorkbenchState(["query"], "query");

    const next = openFileToSide(state, "graph");

    expect(next.groups.map((group) => group.fileIds)).toEqual([["query"], ["graph"]]);
    expect(getActiveWorkbenchFileId(next)).toBe("graph");
  });

  it("removes a side-opened file from the source group when requested", () => {
    const state = createEditorWorkbenchState(["query", "graph"], "query");

    const next = openFileToSide(state, "graph", { removeFromOtherGroups: true });

    expect(next.groups.map((group) => group.fileIds)).toEqual([["query"], ["graph"]]);
    expect(getActiveWorkbenchFileId(next)).toBe("graph");
  });

  it("closes a duplicate tab only in the requested group", () => {
    const state = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));
    const leftGroupId = state.groups[0].id;

    const next = closeFileInGroup(state, leftGroupId, "query");

    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].fileIds).toEqual(["query"]);
    expect(isFileReferenced(next, "query")).toBe(true);
  });

  it("tracks when a file is no longer referenced by any group", () => {
    const state = createEditorWorkbenchState(["query"], "query");

    const next = closeFileInGroup(state, state.groups[0].id, "query");

    expect(next.groups).toHaveLength(1);
    expect(next.groups[0].fileIds).toEqual([]);
    expect(isFileReferenced(next, "query")).toBe(false);
  });

  it("uses per-group activation history when closing an active tab", () => {
    let state = createEditorWorkbenchState(["a", "b", "c"], "a");
    const groupId = state.groups[0].id;
    state = selectFileInGroup(state, groupId, "b");
    state = selectFileInGroup(state, groupId, "c");

    const next = closeFileInGroup(state, groupId, "c");

    expect(next.groups[0].activeFileId).toBe("b");
  });

  it("adds newly opened registry files to the active group only", () => {
    const split = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));
    const result = syncWorkbenchWithFiles(
      split,
      [
        { fileId: "query", uri: "file:///query.sql" },
        { fileId: "graph", uri: "untitled:Graph.qgraph" }
      ],
      { openNewFilesLast: true }
    );

    expect(result.addedFileIds).toEqual(["graph"]);
    expect(result.state.groups.map((group) => group.fileIds)).toEqual([["query"], ["query", "graph"]]);
    expect(result.state.groups[1].activeFileId).toBe("graph");
  });

  it("removes registry-closed files from every group", () => {
    const split = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));

    const result = syncWorkbenchWithFiles(split, [], { openNewFilesLast: true });

    expect(listWorkbenchFileIds(result.state)).toEqual([]);
    expect(result.state.groups).toHaveLength(1);
  });

  it("resizes adjacent editor groups while preserving total size", () => {
    const state = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));

    const next = resizeAdjacentEditorGroups(state, 0, 0.2, 0.1);

    expect(next.sizes[0]).toBeCloseTo(0.7);
    expect(next.sizes[1]).toBeCloseTo(0.3);
    expect(next.sizes.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1);
  });

  it("clamps editor group resizing to the minimum size", () => {
    const state = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));

    const next = resizeAdjacentEditorGroups(state, 0, -0.9, 0.2);

    expect(next.sizes).toEqual([0.2, 0.8]);
  });

  it("persists current side-by-side groups as a horizontal split tree", () => {
    const state = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));

    expect(createPersistedEditorLayout(state)).toEqual({
      kind: "split",
      direction: "horizontal",
      children: [
        { kind: "leaf", groupId: state.groups[0].id },
        { kind: "leaf", groupId: state.groups[1].id }
      ],
      sizes: [0.5, 0.5]
    });
  });

  it("restores editor groups from a persisted split tree", () => {
    const restored = restoreEditorWorkbenchStateFromSnapshot(
      [
        { fileId: "query", uri: "file:///query.sql" },
        { fileId: "graph", uri: "untitled:Graph.qjdbcgraph" }
      ],
      {
        editorGroups: [
          { id: "right", fileUris: ["untitled:Graph.qjdbcgraph"], activeFileUri: "untitled:Graph.qjdbcgraph" },
          { id: "left", fileUris: ["file:///query.sql"], activeFileUri: "file:///query.sql" }
        ],
        activeEditorGroupId: "right",
        editorLayout: {
          kind: "split",
          direction: "horizontal",
          children: [
            { kind: "leaf", groupId: "left" },
            { kind: "leaf", groupId: "right" }
          ],
          sizes: [0.7, 0.3]
        }
      },
      "query"
    );

    expect(restored.groups.map((group) => group.id)).toEqual(["left", "right"]);
    expect(restored.groups.map((group) => group.fileIds)).toEqual([["query"], ["graph"]]);
    expect(restored.activeGroupId).toBe("right");
    expect(restored.sizes).toEqual([0.7, 0.3]);
  });

  it("falls back to equal sizes when persisted layout tree does not match groups", () => {
    const restored = restoreEditorWorkbenchStateFromSnapshot(
      [
        { fileId: "query", uri: "file:///query.sql" },
        { fileId: "graph", uri: "untitled:Graph.qjdbcgraph" }
      ],
      {
        editorGroups: [
          { id: "left", fileUris: ["file:///query.sql"], activeFileUri: "file:///query.sql" },
          { id: "right", fileUris: ["untitled:Graph.qjdbcgraph"], activeFileUri: "untitled:Graph.qjdbcgraph" }
        ],
        activeEditorGroupId: "right",
        editorLayout: {
          kind: "split",
          direction: "horizontal",
          children: [
            { kind: "leaf", groupId: "left" },
            { kind: "leaf", groupId: "missing" }
          ],
          sizes: [0.8, 0.2]
        }
      },
      "query"
    );

    expect(restored.groups.map((group) => group.id)).toEqual(["left", "right"]);
    expect(restored.activeGroupId).toBe("right");
    expect(restored.sizes).toEqual([0.5, 0.5]);
  });
});
