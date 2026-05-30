export type OpenPanelRequest = {
  tabId?: string;
  toggle?: boolean;
};

const OPEN_PANEL_EVENT = "queryeer:layout:open-panel";

export function requestOpenPanel(request: OpenPanelRequest = {}): void {
  window.dispatchEvent(new CustomEvent<OpenPanelRequest>(OPEN_PANEL_EVENT, { detail: request }));
}

export function subscribeOpenPanelRequests(listener: (request: OpenPanelRequest) => void): () => void {
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<OpenPanelRequest>;
    listener(customEvent.detail ?? {});
  };
  window.addEventListener(OPEN_PANEL_EVENT, handler);
  return () => {
    window.removeEventListener(OPEN_PANEL_EVENT, handler);
  };
}
