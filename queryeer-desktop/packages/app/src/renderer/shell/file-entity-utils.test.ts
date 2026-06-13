import { describe, expect, it } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { filesAreStructurallyIdentical } from "./file-entity-utils";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///query.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

describe("filesAreStructurallyIdentical", () => {
  it("ignores typing-time dirty/version changes", () => {
    const previous = [makeFile({ dirtyVsDisk: false, version: 1 })];
    const next = [makeFile({ dirtyVsDisk: true, version: 20 })];

    expect(filesAreStructurallyIdentical(previous, next)).toBe(true);
  });

  it("detects layout-relevant file changes", () => {
    const previous = [makeFile({ editorId: "core.editor.text" })];
    const next = [makeFile({ editorId: "core.graph.viewer" })];

    expect(filesAreStructurallyIdentical(previous, next)).toBe(false);
  });
});
