import { describe, expect, it, vi } from "vitest";
import {
  requestFocusSidebarView,
  subscribeFocusSidebarViewRequests
} from "./layout-sidebar-events";

describe("layout sidebar events", () => {
  it("publishes focus-sidebar-view requests", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFocusSidebarViewRequests(listener);

    requestFocusSidebarView({ zone: "primarySidebar", viewId: "core.flow.context" });

    expect(listener).toHaveBeenCalledWith({ zone: "primarySidebar", viewId: "core.flow.context" });

    unsubscribe();
  });

  it("publishes an empty request by default", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFocusSidebarViewRequests(listener);

    requestFocusSidebarView();

    expect(listener).toHaveBeenCalledWith({});

    unsubscribe();
  });
});
