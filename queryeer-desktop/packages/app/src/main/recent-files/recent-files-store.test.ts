import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RecentFilesStore, defaultRecentFilesPath } from "./recent-files-store.js";

describe("RecentFilesStore", () => {
  let store: RecentFilesStore;
  let workDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "queryeer-recent-"));
    const recentFilesPath = join(workDir, "recent-files.json");
    store = new RecentFilesStore({
      recentFilesPath,
      maxCount: 3,
      now: () => "2024-01-01T00:00:00.000Z"
    });
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  describe("list", () => {
    it("returns empty array when no file exists", async () => {
      const result = await store.list();
      expect(result).toEqual([]);
    });
  });

  describe("add", () => {
    it("adds a new file to empty list", async () => {
      await store.add("file:///a.txt", 3);
      const result = await store.list();
      expect(result).toHaveLength(1);
      expect(result[0]?.uri).toBe("file:///a.txt");
    });

    it("moves existing file to front", async () => {
      await store.add("file:///a.txt", 3);
      await store.add("file:///b.txt", 3);
      await store.add("file:///a.txt", 3);
      const result = await store.list();
      expect(result).toHaveLength(2);
      expect(result[0]?.uri).toBe("file:///a.txt");
    });

    it("trims to maxCount", async () => {
      await store.add("file:///a.txt", 3);
      await store.add("file:///b.txt", 3);
      await store.add("file:///c.txt", 3);
      await store.add("file:///d.txt", 3);
      const result = await store.list();
      expect(result).toHaveLength(3);
      expect(result[0]?.uri).toBe("file:///d.txt");
    });
  });

  describe("remove", () => {
    it("removes existing file", async () => {
      await store.add("file:///a.txt", 3);
      await store.add("file:///b.txt", 3);
      await store.remove("file:///a.txt");
      const result = await store.list();
      expect(result).toHaveLength(1);
      expect(result[0]?.uri).toBe("file:///b.txt");
    });

    it("handles missing file gracefully", async () => {
      await store.add("file:///a.txt", 3);
      await store.remove("file:///missing.txt");
      const result = await store.list();
      expect(result).toHaveLength(1);
    });
  });

  describe("clear", () => {
    it("clears all files", async () => {
      await store.add("file:///a.txt", 3);
      await store.add("file:///b.txt", 3);
      await store.clear();
      const result = await store.list();
      expect(result).toHaveLength(0);
    });
  });
});

describe("defaultRecentFilesPath", () => {
  it("returns path in userData directory", () => {
    const result = defaultRecentFilesPath("/some/user/data");
    expect(result).toContain("settings");
    expect(result).toContain("recent-files.json");
  });
});
