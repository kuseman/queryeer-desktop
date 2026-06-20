import { Profiler, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationStatusItem } from "./NotificationStatusItem";

const notificationHarness = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = {
    unread: 0,
    notifications: [] as unknown[],
    onRender: vi.fn(),
    unreadCount: vi.fn(() => state.unread),
    list: vi.fn(() => state.notifications),
    markAllRead: vi.fn(() => {
      state.unread = 0;
      for (const listener of listeners) {
        listener();
      }
    }),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    emit: () => {
      for (const listener of listeners) {
        listener();
      }
    },
    reset: () => {
      state.unread = 0;
      state.notifications = [];
      state.onRender.mockClear();
      state.unreadCount.mockClear();
      state.list.mockClear();
      state.markAllRead.mockClear();
      state.subscribe.mockClear();
      listeners.clear();
    }
  };
  return state;
});

vi.mock("./notification-service", () => ({
  getNotificationService: () => ({
    unreadCount: notificationHarness.unreadCount,
    list: notificationHarness.list,
    markAllRead: notificationHarness.markAllRead,
    subscribe: notificationHarness.subscribe,
    notify: vi.fn(),
    markRead: vi.fn(),
    dismissToast: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn()
  })
}));

describe("NotificationStatusItem", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    notificationHarness.reset();
    rootElement = document.createElement("div");
    document.body.append(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("does not rerender closed bell when unread count is unchanged", () => {
    act(() => {
      root.render(
        <Profiler id="notification-status" onRender={notificationHarness.onRender}>
          <NotificationStatusItem />
        </Profiler>
      );
    });
    notificationHarness.onRender.mockClear();

    act(() => {
      notificationHarness.emit();
    });

    expect(notificationHarness.onRender).not.toHaveBeenCalled();

    notificationHarness.unread = 1;
    act(() => {
      notificationHarness.emit();
    });

    expect(notificationHarness.onRender).toHaveBeenCalledTimes(1);
  });
});
