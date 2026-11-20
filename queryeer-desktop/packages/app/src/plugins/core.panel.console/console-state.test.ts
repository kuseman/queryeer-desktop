import { afterEach, describe, expect, it } from "vitest";
import type { BackendLogEntry } from "@queryeer/api/backend";
import {
  MAX_CONSOLE_LOG_ENTRIES,
  addFrontendLogEntry,
  clearConsoleLogEntries,
  getConsolePanelVisible,
  getConsoleNotificationState,
  getConsoleLogEntries,
  ingestBackendLogEntries,
  notifyConsoleErrorAppended,
  resetConsoleNotifications,
  setConsolePanelVisible,
  subscribeConsoleNotification
} from "./console-state";

afterEach(() => {
  setConsolePanelVisible(false);
  resetConsoleNotifications();
  clearConsoleLogEntries();
});

function backendEntry(level: BackendLogEntry["level"], message: string, timestamp = new Date().toISOString()): BackendLogEntry {
  return { timestamp, level, source: "backend", message };
}

describe("console-state", () => {
  it("always increments unseen error count and notifies listeners", () => {
    let notifications = 0;
    const dispose = subscribeConsoleNotification(() => {
      notifications += 1;
    });

    notifyConsoleErrorAppended();
    notifyConsoleErrorAppended();

    expect(getConsoleNotificationState().unseenErrorCount).toBe(2);
    expect(notifications).toBe(2);
    dispose();
  });

  it("counts errors even while panel is visible", () => {
    setConsolePanelVisible(true);

    notifyConsoleErrorAppended();
    notifyConsoleErrorAppended();

    expect(getConsoleNotificationState().unseenErrorCount).toBe(2);
  });

  it("resets count when panel becomes visible", () => {
    notifyConsoleErrorAppended();
    notifyConsoleErrorAppended();
    expect(getConsoleNotificationState().unseenErrorCount).toBe(2);

    setConsolePanelVisible(true);
    expect(getConsoleNotificationState().unseenErrorCount).toBe(0);
  });

  it("emits when panel becomes hidden so status item can react", () => {
    setConsolePanelVisible(true);
    notifyConsoleErrorAppended();

    let notifications = 0;
    const dispose = subscribeConsoleNotification(() => {
      notifications += 1;
    });

    setConsolePanelVisible(false);
    expect(notifications).toBe(1);
    expect(getConsolePanelVisible()).toBe(false);
    dispose();
  });

  it("does not emit when panel visibility is unchanged", () => {
    setConsolePanelVisible(false);
    let notifications = 0;
    const dispose = subscribeConsoleNotification(() => {
      notifications += 1;
    });

    setConsolePanelVisible(false);

    expect(notifications).toBe(0);
    dispose();
  });

  it("resets unseen errors explicitly", () => {
    notifyConsoleErrorAppended();
    resetConsoleNotifications();
    expect(getConsoleNotificationState().unseenErrorCount).toBe(0);
  });

  describe("frontend log entries", () => {
    it("adds and retrieves frontend log entries", () => {
      addFrontendLogEntry("error", "TestModule", "Something went wrong");
      addFrontendLogEntry("warn", "TestModule", "Warning message");

      const entries = getConsoleLogEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].origin).toBe("frontend");
      expect(entries[0].level).toBe("error");
      expect(entries[0].source).toBe("TestModule");
      expect(entries[0].message).toBe("Something went wrong");
      expect(entries[1].level).toBe("warn");
      expect(entries[1].message).toBe("Warning message");
    });

    it("increments unseen error count when panel is hidden", () => {
      setConsolePanelVisible(false);
      const before = getConsoleNotificationState().unseenErrorCount;

      addFrontendLogEntry("error", "TestModule", "Error");

      expect(getConsoleNotificationState().unseenErrorCount).toBe(before + 1);
    });

    it("does NOT increment unseen error count when panel is visible", () => {
      setConsolePanelVisible(true);
      resetConsoleNotifications();

      addFrontendLogEntry("error", "TestModule", "Error");

      expect(getConsoleNotificationState().unseenErrorCount).toBe(0);
    });

    it("does not increment unseen count for non-error levels", () => {
      setConsolePanelVisible(false);
      const before = getConsoleNotificationState().unseenErrorCount;

      addFrontendLogEntry("info", "TestModule", "Info message");
      addFrontendLogEntry("warn", "TestModule", "Warning");

      expect(getConsoleNotificationState().unseenErrorCount).toBe(before);
    });

    it("clears all frontend entries", () => {
      addFrontendLogEntry("error", "TestModule", "Err");
      expect(getConsoleLogEntries()).toHaveLength(1);

      clearConsoleLogEntries();
      expect(getConsoleLogEntries()).toHaveLength(0);
    });

    it("includes timestamp on each entry", () => {
      addFrontendLogEntry("info", "Test", "msg");
      const entry = getConsoleLogEntries()[0];
      expect(entry.timestamp).toBeDefined();
      expect(() => new Date(entry.timestamp)).not.toThrow();
    });
  });

  describe("backend log entries", () => {
    it("ingests backend entries and skips ones already seen", () => {
      const first = backendEntry("info", "one");
      const second = backendEntry("warn", "two");

      ingestBackendLogEntries([first]);
      ingestBackendLogEntries([first, second]);

      expect(getConsoleLogEntries().map((entry) => entry.message)).toEqual(["one", "two"]);
      expect(getConsoleLogEntries()[0].origin).toBe("backend");
    });

    it("counts new backend errors only while the panel is hidden", () => {
      ingestBackendLogEntries([backendEntry("error", "hidden error")]);
      expect(getConsoleNotificationState().unseenErrorCount).toBe(1);

      // Re-polling the same buffer does not count the error twice
      ingestBackendLogEntries([backendEntry("error", "hidden error", getConsoleLogEntries()[0].timestamp)]);
      expect(getConsoleNotificationState().unseenErrorCount).toBe(1);

      setConsolePanelVisible(true);
      ingestBackendLogEntries([backendEntry("error", "visible error")]);
      expect(getConsoleNotificationState().unseenErrorCount).toBe(0);
    });

    it("keeps errors after the main-process buffer has evicted them", () => {
      // Regression: the panel used to re-read the main-process ring buffer on open,
      // so an error counted by the badge could be gone by the time the user clicked.
      const error = backendEntry("error", "boom");
      ingestBackendLogEntries([error]);
      ingestBackendLogEntries([backendEntry("debug", "later noise")]);

      setConsolePanelVisible(true);

      expect(getConsoleLogEntries().map((entry) => entry.message)).toEqual(["boom", "later noise"]);
    });

    it("does not emit when nothing new was ingested", () => {
      const entry = backendEntry("info", "one");
      ingestBackendLogEntries([entry]);
      let notifications = 0;
      const dispose = subscribeConsoleNotification(() => {
        notifications += 1;
      });

      ingestBackendLogEntries([entry]);

      expect(notifications).toBe(0);
      dispose();
    });

    it("ignores backend entries logged before a clear", () => {
      const beforeClear = backendEntry("error", "old", "2000-01-01T00:00:00.000Z");
      clearConsoleLogEntries();

      ingestBackendLogEntries([beforeClear]);

      expect(getConsoleLogEntries()).toHaveLength(0);
    });

    it("does not re-ingest or re-count an entry the store evicted while main still holds it", () => {
      const now = Date.now();
      const backendError = backendEntry("error", "backend error", new Date(now).toISOString());
      ingestBackendLogEntries([backendError]);
      for (let i = 0; i < MAX_CONSOLE_LOG_ENTRIES; i += 1) {
        addFrontendLogEntry("error", "Loop", `frontend-${i}`);
      }
      expect(getConsoleLogEntries().some((entry) => entry.message === "backend error")).toBe(false);
      const countBefore = getConsoleNotificationState().unseenErrorCount;

      // Main's priority-evicting buffer still holds the old error
      ingestBackendLogEntries([backendError]);

      expect(getConsoleLogEntries().some((entry) => entry.message === "backend error")).toBe(false);
      expect(getConsoleNotificationState().unseenErrorCount).toBe(countBefore);
    });

    it("evicts low-priority entries before errors when over capacity", () => {
      const now = Date.now();
      ingestBackendLogEntries([backendEntry("error", "keep me", new Date(now).toISOString())]);
      const noise: BackendLogEntry[] = [];
      for (let i = 0; i < MAX_CONSOLE_LOG_ENTRIES + 10; i += 1) {
        noise.push(backendEntry("debug", `noise-${i}`, new Date(now + 1000).toISOString()));
      }

      ingestBackendLogEntries(noise);

      const entries = getConsoleLogEntries();
      expect(entries).toHaveLength(MAX_CONSOLE_LOG_ENTRIES);
      expect(entries[0].message).toBe("keep me");
      expect(entries[entries.length - 1].message).toBe(`noise-${MAX_CONSOLE_LOG_ENTRIES + 9}`);
    });
  });
});
