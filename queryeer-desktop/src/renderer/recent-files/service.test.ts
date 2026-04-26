import { describe, expect, it, vi } from "vitest";
import { RecentFilesService } from "./service";

describe("RecentFilesService", () => {
  const createService = (overrides?: {
    getRecentFiles?: () => Promise<{ uri: string; lastOpenedAt: string }[]>;
    removeRecentFile?: (uri: string) => Promise<{ removed: boolean }>;
    getStat?: (uri: string) => Promise<{ success: boolean; stat: { isFile: boolean } | null }>;
    showDialog?: (options: {
      title: string;
      message: string;
      severity?: "warning";
      detail?: string;
      options?: { label: string; value: string }[];
    }) => Promise<{ action: string }>;
  }) => {
    return new RecentFilesService({
      bridge: {
        getRecentFiles: overrides?.getRecentFiles ?? vi.fn(async () => []),
        addRecentFile: vi.fn(async () => ({ accepted: true })),
        removeRecentFile: overrides?.removeRecentFile ?? vi.fn(async () => ({ removed: true })),
        clearRecentFiles: vi.fn(async () => ({ cleared: true }))
      },
      getStat: overrides?.getStat ?? vi.fn(async () => ({ success: true, stat: { isFile: true } })),
      showDialog: overrides?.showDialog ??
        vi.fn(async () => ({ action: "cancel" }))
    });
  };

  describe("getRecentFiles", () => {
    it("returns empty array when no recent files", async () => {
      const service = createService({
        getRecentFiles: async () => []
      });
      const result = await service.getRecentFiles();
      expect(result).toEqual([]);
    });
  });

  describe("openRecentFile", () => {
    it("returns false when no recent files", async () => {
      const service = createService();
      const result = await service.openRecentFile(async () => {});
      expect(result.opened).toBe(false);
    });

    it("opens file when it exists", async () => {
      const openFile = vi.fn(async () => {});
      const service = createService({
        getRecentFiles: async () => [
          { uri: "file:///a.txt", lastOpenedAt: "2024-01-01T00:00:00.000Z" }
        ],
        getStat: async () => ({ success: true, stat: { isFile: true } })
      });
      const result = await service.openRecentFile(openFile);
      expect(result.opened).toBe(true);
      expect(openFile).toHaveBeenCalledWith("file:///a.txt");
    });

    it("shows dialog and removes when file missing", async () => {
      const removeRecentFile = vi.fn(async () => ({ removed: true }));
      const service = createService({
        getRecentFiles: async () => [
          { uri: "file:///missing.txt", lastOpenedAt: "2024-01-01T00:00:00.000Z" }
        ],
        getStat: async () => ({ success: false, stat: null }),
        showDialog: async () => ({ action: "remove" }),
        removeRecentFile
      });
      const result = await service.openRecentFile(async () => {});
      expect(result.opened).toBe(false);
      expect(removeRecentFile).toHaveBeenCalledWith("file:///missing.txt");
    });
  });
});