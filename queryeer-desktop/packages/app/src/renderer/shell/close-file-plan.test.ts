import { describe, expect, it } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { createEditorWorkbenchState, splitActiveGroupRight } from "./editor-workbench-state";
import { planCloseFileInGroup } from "./close-file-plan";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "query",
    version: 1,
    uri: "file:///query.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("planCloseFileInGroup", () => {
  it("requires confirmation for a dirty split reference even when file stays open elsewhere", () => {
    const state = splitActiveGroupRight(createEditorWorkbenchState(["query"], "query"));
    const leftGroupId = state.groups[0].id;

    const plan = planCloseFileInGroup(
      state,
      leftGroupId,
      "query",
      makeFile({ dirtyVsDisk: true })
    );

    expect(plan.shouldConfirm).toBe(true);
    expect(plan.shouldCloseGlobally).toBe(false);
    expect(plan.nextWorkbench.groups).toHaveLength(1);
    expect(plan.nextWorkbench.groups[0].fileIds).toEqual(["query"]);
  });

  it("closes globally only when the last reference is removed", () => {
    const state = createEditorWorkbenchState(["query"], "query");

    const plan = planCloseFileInGroup(state, state.activeGroupId, "query", makeFile());

    expect(plan.shouldConfirm).toBe(false);
    expect(plan.shouldCloseGlobally).toBe(true);
  });
});
