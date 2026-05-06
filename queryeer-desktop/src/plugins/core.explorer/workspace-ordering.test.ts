import { describe, expect, it } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { orderWorkspaceFiles } from "./workspace-ordering";

function makeFile(fileId: string, uri: string): FileEntity {
  return {
    fileId,
    version: 0,
    uri,
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString()
  };
}

describe("orderWorkspaceFiles", () => {
  it("keeps incoming order for tabOrder", () => {
    const files = [
      makeFile("f2", "file:///tmp/z.sql"),
      makeFile("f1", "file:///tmp/a.sql")
    ];

    const ordered = orderWorkspaceFiles(files, "tabOrder", new Map());

    expect(ordered.map((f) => f.fileId)).toEqual(["f2", "f1"]);
  });

  it("sorts alphabetically by filename", () => {
    const files = [
      makeFile("f2", "file:///tmp/z.sql"),
      makeFile("f1", "file:///tmp/a.sql")
    ];

    const ordered = orderWorkspaceFiles(files, "alphabetical", new Map());

    expect(ordered.map((f) => f.fileId)).toEqual(["f1", "f2"]);
  });

  it("sorts by most recently used rank descending", () => {
    const files = [
      makeFile("f1", "file:///tmp/a.sql"),
      makeFile("f2", "file:///tmp/b.sql"),
      makeFile("f3", "file:///tmp/c.sql")
    ];

    const ordered = orderWorkspaceFiles(
      files,
      "lastUsed",
      new Map([
        ["f1", 1],
        ["f3", 3],
        ["f2", 2]
      ])
    );

    expect(ordered.map((f) => f.fileId)).toEqual(["f3", "f2", "f1"]);
  });
});
