import { describe, expect, it } from "vitest";
import {
  closeFileInGroup,
  createEditorWorkbenchState,
  createPersistedEditorLayout,
  focusEditorGroup,
  getActiveWorkbenchFileId,
  isFileReferenced,
  listWorkbenchFileIds,
  moveFileToSide,
  openFileToSide,
  resizeAdjacentEditorGroups,
  restoreEditorWorkbenchStateFromSnapshot,
  selectFileInGroup,
  splitActiveGroupRight,
  syncWorkbenchWithFiles,
  toggleMaximizedEditorGroup
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

  it("does not allocate a new state when focusing the already-active group", () => {
    const state = createEditorWorkbenchState(["query"], "query");

    const next = focusEditorGroup(state, state.activeGroupId);

    expect(next).toBe(state);
  });

  it("maximizes and restores a requested editor group", () => {
    const state = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));
    const leftGroupId = state.groups[0].id;

    const maximized = toggleMaximizedEditorGroup(state, leftGroupId);
    const restored = toggleMaximizedEditorGroup(maximized, leftGroupId);

    expect(maximized.activeGroupId).toBe(leftGroupId);
    expect(maximized.maximizedGroupId).toBe(leftGroupId);
    expect(restored.maximizedGroupId).toBeNull();
  });

  it("does not maximize a single editor group", () => {
    const state = createEditorWorkbenchState(["query"], "query");

    const next = toggleMaximizedEditorGroup(state, state.groups[0].id);

    expect(next.maximizedGroupId).toBeNull();
  });

  it("moves maximized state to the focused group", () => {
    const state = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));
    const maximized = toggleMaximizedEditorGroup(state, state.groups[0].id);

    const focused = focusEditorGroup(maximized, state.groups[1].id);

    expect(focused.activeGroupId).toBe(state.groups[1].id);
    expect(focused.maximizedGroupId).toBe(state.groups[1].id);
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

  it("moves a tab to the existing right group and appends when openNewFilesLast is enabled", () => {
    const state = {
      groups: [
        { id: "left", fileIds: ["a", "b"], activeFileId: "a", activationQueue: ["a"] },
        { id: "right", fileIds: ["c", "d"], activeFileId: "c", activationQueue: ["c"] }
      ],
      activeGroupId: "left",
      sizes: [0.6, 0.4]
    };

    const next = moveFileToSide(state, "left", "b", "right", { openNewFilesLast: true });

    expect(next.groups.map((group) => group.fileIds)).toEqual([["a"], ["c", "d", "b"]]);
    expect(next.groups[1].activeFileId).toBe("b");
    expect(next.activeGroupId).toBe("right");
    expect(next.sizes).toEqual([0.6, 0.4]);
  });

  it("moves a tab after the target active tab when openNewFilesLast is disabled", () => {
    const state = {
      groups: [
        { id: "left", fileIds: ["a", "b"], activeFileId: "a", activationQueue: ["a"] },
        { id: "right", fileIds: ["c", "d"], activeFileId: "c", activationQueue: ["c"] }
      ],
      activeGroupId: "left",
      sizes: [0.5, 0.5]
    };

    const next = moveFileToSide(state, "left", "b", "right", { openNewFilesLast: false });

    expect(next.groups.map((group) => group.fileIds)).toEqual([["a"], ["c", "b", "d"]]);
    expect(next.groups[1].activeFileId).toBe("b");
  });

  it("creates a right group when moving right from the rightmost group with multiple tabs", () => {
    const state = createEditorWorkbenchState(["a", "b"], "a");

    const next = moveFileToSide(state, state.groups[0].id, "b", "right", { openNewFilesLast: true });

    expect(next.groups.map((group) => group.fileIds)).toEqual([["a"], ["b"]]);
    expect(next.groups[1].activeFileId).toBe("b");
    expect(next.activeGroupId).toBe(next.groups[1].id);
  });

  it("does not create a right group when moving the only tab in the only group", () => {
    const state = createEditorWorkbenchState(["a"], "a");

    const next = moveFileToSide(state, state.groups[0].id, "a", "right", { openNewFilesLast: true });

    expect(next).toBe(state);
  });

  it("moves a tab left only from a non-main group", () => {
    const state = {
      groups: [
        { id: "left", fileIds: ["a"], activeFileId: "a", activationQueue: ["a"] },
        { id: "right", fileIds: ["b", "c"], activeFileId: "b", activationQueue: ["b"] }
      ],
      activeGroupId: "right",
      sizes: [0.5, 0.5]
    };

    const next = moveFileToSide(state, "right", "c", "left", { openNewFilesLast: true });
    const noOp = moveFileToSide(state, "left", "a", "left", { openNewFilesLast: true });

    expect(next.groups.map((group) => group.fileIds)).toEqual([["a", "c"], ["b"]]);
    expect(next.activeGroupId).toBe("left");
    expect(noOp).toBe(state);
  });

  it("removes a duplicate tab from the source and activates the existing target tab", () => {
    const state = {
      groups: [
        { id: "left", fileIds: ["a", "b"], activeFileId: "a", activationQueue: ["a"] },
        { id: "right", fileIds: ["b", "c"], activeFileId: "c", activationQueue: ["c"] }
      ],
      activeGroupId: "left",
      sizes: [0.5, 0.5]
    };

    const next = moveFileToSide(state, "left", "b", "right", { openNewFilesLast: true });

    expect(next.groups.map((group) => group.fileIds)).toEqual([["a"], ["b", "c"]]);
    expect(next.groups[1].activeFileId).toBe("b");
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

  it("clears maximized state when syncing down to one group", () => {
    const split = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));
    const maximized = toggleMaximizedEditorGroup(split, split.groups[1].id);

    const result = syncWorkbenchWithFiles(maximized, [], { openNewFilesLast: true });

    expect(result.state.groups).toHaveLength(1);
    expect(result.state.maximizedGroupId).toBeNull();
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

  it("restores a persisted maximized editor group as the active group", () => {
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
        activeEditorGroupId: "left",
        maximizedEditorGroupId: "right"
      },
      "query"
    );

    expect(restored.activeGroupId).toBe("right");
    expect(restored.maximizedGroupId).toBe("right");
  });

  it("clears invalid persisted maximized editor groups", () => {
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
        activeEditorGroupId: "left",
        maximizedEditorGroupId: "missing"
      },
      "query"
    );

    expect(restored.activeGroupId).toBe("left");
    expect(restored.maximizedGroupId).toBeNull();
  });

  it("clears a persisted maximized editor group when only one group is restored", () => {
    const restored = restoreEditorWorkbenchStateFromSnapshot(
      [{ fileId: "query", uri: "file:///query.sql" }],
      {
        editorGroups: [
          { id: "left", fileUris: ["file:///query.sql"], activeFileUri: "file:///query.sql" }
        ],
        activeEditorGroupId: "left",
        maximizedEditorGroupId: "left"
      },
      "query"
    );

    expect(restored.activeGroupId).toBe("left");
    expect(restored.maximizedGroupId).toBeNull();
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
