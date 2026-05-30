import { describe, expect, it, vi } from "vitest";
import { confirmCloseDirtyFile, fileDisplayName } from "./close-file-guard";
import type { FileEntity } from "@queryeer/api/files/FileEntity";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "f-1",
    version: 1,
    uri: "file:///C:/tmp/a.sql",
    mimeType: "text/plain",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

describe("close-file-guard", () => {
  it("returns true without dialog for clean files", async () => {
    const showDialog = vi.fn(async () => ({ action: "" }));
    const ok = await confirmCloseDirtyFile(makeFile(), showDialog);

    expect(ok).toBe(true);
    expect(showDialog).not.toHaveBeenCalled();
  });

  it("shows dialog for dirty files and allows discard", async () => {
    const showDialog = vi.fn(async () => ({ action: "discard" }));
    const ok = await confirmCloseDirtyFile(
      makeFile({ uri: "untitled:Query1.sql", dirtyVsDisk: true }),
      showDialog
    );

    expect(ok).toBe(true);
    expect(showDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Unsaved Changes",
        message: expect.stringContaining("Query1.sql")
      })
    );
  });

  it("returns false when user cancels dirty close", async () => {
    const showDialog = vi.fn(async () => ({ action: "cancel" }));
    const ok = await confirmCloseDirtyFile(
      makeFile({ dirtyVsBackend: true }),
      showDialog
    );

    expect(ok).toBe(false);
  });

  it("formats file display names", () => {
    expect(fileDisplayName("file:///C:/tmp/a.sql")).toBe("a.sql");
    expect(fileDisplayName("untitled:Scratch")).toBe("Scratch");
    expect(fileDisplayName("app-data://config")).toBe("app-data://config");
  });
});
