import { afterEach, describe, expect, it } from "vitest";
import {
  addFrontendLogEntry,
  clearFrontendLogEntries,
  getConsolePanelVisible,
  getConsoleNotificationState,
  getFrontendLogEntries,
  notifyConsoleErrorAppended,
  resetConsoleNotifications,
  setConsolePanelVisible,
  subscribeConsoleNotification
} from "./console-state";

afterEach(() => {
  setConsolePanelVisible(false);
  resetConsoleNotifications();
});

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

  it("resets unseen errors explicitly", () => {
    notifyConsoleErrorAppended();
    resetConsoleNotifications();
    expect(getConsoleNotificationState().unseenErrorCount).toBe(0);
  });

  describe("frontend log entries", () => {
    afterEach(() => {
      clearFrontendLogEntries();
    });

    it("adds and retrieves frontend log entries", () => {
      addFrontendLogEntry("error", "TestModule", "Something went wrong");
      addFrontendLogEntry("warn", "TestModule", "Warning message");

      const entries = getFrontendLogEntries();
      expect(entries).toHaveLength(2);
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
      expect(getFrontendLogEntries()).toHaveLength(1);

      clearFrontendLogEntries();
      expect(getFrontendLogEntries()).toHaveLength(0);
    });

    it("includes timestamp on each entry", () => {
      addFrontendLogEntry("info", "Test", "msg");
      const entry = getFrontendLogEntries()[0];
      expect(entry.timestamp).toBeDefined();
      expect(() => new Date(entry.timestamp)).not.toThrow();
    });
  });
});
