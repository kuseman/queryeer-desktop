import { describe, expect, it } from "vitest";
import {
  getConsoleNotificationState,
  notifyConsoleErrorAppended,
  resetConsoleNotifications,
  subscribeConsoleNotification
} from "./console-state";

describe("console-state", () => {
  it("increments unseen error count and notifies listeners", () => {
    resetConsoleNotifications();
    let notifications = 0;
    const dispose = subscribeConsoleNotification(() => {
      notifications += 1;
    });

    notifyConsoleErrorAppended();
    notifyConsoleErrorAppended();

    expect(getConsoleNotificationState().unseenErrorCount).toBe(2);
    expect(notifications).toBe(2);
    dispose();
    resetConsoleNotifications();
  });

  it("resets unseen errors", () => {
    resetConsoleNotifications();
    notifyConsoleErrorAppended();
    expect(getConsoleNotificationState().unseenErrorCount).toBe(1);

    resetConsoleNotifications();
    expect(getConsoleNotificationState().unseenErrorCount).toBe(0);
  });
});
