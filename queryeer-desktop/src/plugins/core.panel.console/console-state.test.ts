import { afterEach, describe, expect, it } from "vitest";
import {
  getConsolePanelVisible,
  getConsoleNotificationState,
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
});
