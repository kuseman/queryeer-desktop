import { describe, expect, it, vi } from "vitest";
import type { NotificationService } from "@queryeer/api/extensions/NotificationExtension";
import { checkForUpdates, compareVersions, RELEASES_PAGE_URL } from "./update-checker";

function createNotifications(): NotificationService {
  return {
    notify: vi.fn((notification) => ({
      ...notification,
      id: "n1",
      severity: notification.severity ?? "info",
      createdAt: new Date(0).toISOString(),
      read: false,
      toastDismissed: false
    })),
    list: vi.fn(() => []),
    unreadCount: vi.fn(() => 0),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismissToast: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => {})
  };
}

describe("compareVersions", () => {
  it("compares v-prefixed semantic versions", () => {
    expect(compareVersions("v1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.2.1")).toBe(-1);
  });
});

describe("checkForUpdates", () => {
  it("notifies when the latest stable release is newer", async () => {
    const notifications = createNotifications();
    const openExternal = vi.fn(async () => {});
    const fetchReleases = vi.fn(async () => ({
      ok: true,
      releases: [
        { tag_name: "v2.0.0-beta.1", prerelease: true, draft: false },
        { tag_name: "v1.4.0", prerelease: false, draft: false, html_url: "https://example.test/v1.4.0" }
      ]
    }));

    await checkForUpdates({
      currentVersion: "1.3.0",
      fetchReleases,
      notifications,
      openExternal
    });

    expect(fetchReleases).toHaveBeenCalledOnce();
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "New Queryeer version available",
      message: expect.stringContaining("1.4.0")
    }));

    const notification = vi.mocked(notifications.notify).mock.calls[0][0];
    await notification.actions?.[0].run();
    expect(openExternal).toHaveBeenCalledWith("https://example.test/v1.4.0");
  });

  it("does not notify for prereleases or older releases", async () => {
    const notifications = createNotifications();
    const fetchReleases = vi.fn(async () => ({
      ok: true,
      releases: [
        { tag_name: "v2.0.0-beta.1", prerelease: true, draft: false },
        { tag_name: "v1.2.0", prerelease: false, draft: false }
      ]
    }));

    await checkForUpdates({
      currentVersion: "1.3.0",
      fetchReleases,
      notifications,
      openExternal: vi.fn(async () => {})
    });

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("uses the releases page when GitHub omits html_url", async () => {
    const notifications = createNotifications();
    const openExternal = vi.fn(async () => {});
    const fetchReleases = vi.fn(async () => ({
      ok: true,
      releases: [{ tag_name: "v1.4.0", prerelease: false, draft: false }]
    }));

    await checkForUpdates({
      currentVersion: "1.3.0",
      fetchReleases,
      notifications,
      openExternal
    });

    const notification = vi.mocked(notifications.notify).mock.calls[0][0];
    await notification.actions?.[0].run();
    expect(openExternal).toHaveBeenCalledWith(RELEASES_PAGE_URL);
  });
});
