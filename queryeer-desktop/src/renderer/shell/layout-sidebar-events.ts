import type { SidebarZone } from "../../contracts/extensions/LayoutExtension";

export type FocusSidebarViewRequest = {
  zone?: SidebarZone;
  viewId?: string;
};

const FOCUS_SIDEBAR_VIEW_EVENT = "queryeer:layout:focus-sidebar-view";

export function requestFocusSidebarView(request: FocusSidebarViewRequest = {}): void {
  window.dispatchEvent(new CustomEvent<FocusSidebarViewRequest>(FOCUS_SIDEBAR_VIEW_EVENT, { detail: request }));
}

export function subscribeFocusSidebarViewRequests(
  listener: (request: FocusSidebarViewRequest) => void
): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<FocusSidebarViewRequest>;
    listener(customEvent.detail ?? {});
  };
  window.addEventListener(FOCUS_SIDEBAR_VIEW_EVENT, handler);
  return () => {
    window.removeEventListener(FOCUS_SIDEBAR_VIEW_EVENT, handler);
  };
}
