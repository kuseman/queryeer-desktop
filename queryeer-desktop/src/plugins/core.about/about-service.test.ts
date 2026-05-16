import { describe, it, expect, beforeEach } from "vitest";
import {
  openAboutDialog,
  closeAboutDialog,
  isAboutDialogOpen,
  getAboutDialogState,
  setDesktopChangelog,
  setBackendChangelogs,
  setAppMetadata,
  registerChangelog,
  getChangelogEntries,
  hasChangelog,
  subscribeAboutDialog
} from "./about-service.js";

describe("about-service", () => {
  beforeEach(() => {
    closeAboutDialog();
    setDesktopChangelog(null);
    setBackendChangelogs([]);
    setAppMetadata({
      appVersion: "",
      electronVersion: "",
      chromiumVersion: "",
      nodeVersion: "",
      platform: "",
      arch: ""
    });
  });

  describe("open/close state", () => {
    it("starts closed", () => {
      expect(isAboutDialogOpen()).toBe(false);
    });

    it("opens when openAboutDialog is called", () => {
      openAboutDialog();
      expect(isAboutDialogOpen()).toBe(true);
    });

    it("closes when closeAboutDialog is called", () => {
      openAboutDialog();
      closeAboutDialog();
      expect(isAboutDialogOpen()).toBe(false);
    });

    it("is idempotent on open", () => {
      openAboutDialog();
      openAboutDialog();
      expect(isAboutDialogOpen()).toBe(true);
    });

    it("is idempotent on close", () => {
      closeAboutDialog();
      closeAboutDialog();
      expect(isAboutDialogOpen()).toBe(false);
    });
  });

  describe("subscribe", () => {
    it("notifies listeners on open", () => {
      const calls: number[] = [];
      subscribeAboutDialog(() => calls.push(calls.length));
      openAboutDialog();
      expect(calls).toEqual([0]);
    });

    it("notifies listeners on close", () => {
      const calls: number[] = [];
      subscribeAboutDialog(() => calls.push(calls.length));
      openAboutDialog();
      closeAboutDialog();
      expect(calls).toEqual([0, 1]);
    });

    it("unsubscribes correctly", () => {
      const calls: number[] = [];
      const unsub = subscribeAboutDialog(() => calls.push(calls.length));
      openAboutDialog();
      unsub();
      closeAboutDialog();
      expect(calls).toEqual([0]);
    });
  });

  describe("app metadata", () => {
    it("stores and returns app metadata", () => {
      setAppMetadata({
        appVersion: "1.2.3",
        electronVersion: "30.0.0",
        chromiumVersion: "124.0.0",
        nodeVersion: "20.0.0",
        platform: "darwin",
        arch: "arm64"
      });
      const state = getAboutDialogState();
      expect(state.appVersion).toBe("1.2.3");
      expect(state.electronVersion).toBe("30.0.0");
      expect(state.platform).toBe("darwin");
      expect(state.arch).toBe("arm64");
    });
  });

  describe("desktop changelog", () => {
    it("stores and returns desktop changelog", () => {
      setDesktopChangelog("# Changelog\n\n## 1.0.0\n- Initial");
      expect(getAboutDialogState().desktopChangelog).toBe("# Changelog\n\n## 1.0.0\n- Initial");
    });

    it("accepts null", () => {
      setDesktopChangelog("content");
      setDesktopChangelog(null);
      expect(getAboutDialogState().desktopChangelog).toBeNull();
    });
  });

  describe("backend changelogs", () => {
    it("stores and returns backend changelogs", () => {
      const entries = [
        { pluginId: "pb", pluginName: "PayloadBuilder", version: "1.0.0", changelog: "# PB" }
      ];
      setBackendChangelogs(entries);
      expect(getAboutDialogState().backendChangelogs).toEqual(entries);
    });

    it("getChangelogEntries returns sorted by pluginName", () => {
      setBackendChangelogs([
        { pluginId: "z", pluginName: "Zebra", version: "1.0.0", changelog: "" },
        { pluginId: "a", pluginName: "Alpha", version: "1.0.0", changelog: "" }
      ]);
      const sorted = getChangelogEntries();
      expect(sorted[0].pluginId).toBe("a");
      expect(sorted[1].pluginId).toBe("z");
    });
  });

  describe("registerChangelog", () => {
    it("adds a new changelog entry", () => {
      registerChangelog({ pluginId: "pb", pluginName: "PayloadBuilder", version: "1.0.0", changelog: "# PB" });
      expect(hasChangelog("pb")).toBe(true);
    });

    it("replaces an existing entry for the same pluginId", () => {
      registerChangelog({ pluginId: "pb", pluginName: "Old", version: "1.0.0", changelog: "old" });
      registerChangelog({ pluginId: "pb", pluginName: "New", version: "2.0.0", changelog: "new" });
      const entries = getChangelogEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].version).toBe("2.0.0");
      expect(entries[0].changelog).toBe("new");
    });

    it("hasChangelog returns false for unknown plugin", () => {
      expect(hasChangelog("unknown")).toBe(false);
    });
  });
});
