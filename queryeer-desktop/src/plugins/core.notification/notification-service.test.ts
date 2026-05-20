import { describe, expect, it, vi } from "vitest";
import { InMemoryNotificationService } from "./notification-service";

describe("InMemoryNotificationService", () => {
  it("stores unread notifications newest first", () => {
    const service = new InMemoryNotificationService();
    const first = service.notify({ title: "First" });
    const second = service.notify({ title: "Second", severity: "warning" });

    expect(service.list().map((item) => item.id)).toEqual([second.id, first.id]);
    expect(service.unreadCount()).toBe(2);
    expect(second.severity).toBe("warning");
  });

  it("notifies subscribers when state changes", () => {
    const service = new InMemoryNotificationService();
    const listener = vi.fn();
    service.subscribe(listener);

    const notification = service.notify({ title: "Saved" });
    service.markRead(notification.id);
    service.dismissToast(notification.id);
    service.clear(notification.id);

    expect(listener).toHaveBeenCalledTimes(4);
    expect(service.list()).toEqual([]);
  });

  it("marks all notifications read and clears all", () => {
    const service = new InMemoryNotificationService();
    service.notify({ title: "One" });
    service.notify({ title: "Two" });

    service.markAllRead();
    expect(service.unreadCount()).toBe(0);

    service.clearAll();
    expect(service.list()).toEqual([]);
  });
});
