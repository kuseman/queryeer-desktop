import type { LayoutZone } from "@queryeer/api/extensions/LayoutExtension";

const TOGGLE_ZONE_EVENT = "shell:toggleZone";

type ToggleZoneEventDetail = {
  zone: LayoutZone;
};

export function requestToggleZone(zone: LayoutZone): void {
  window.dispatchEvent(
    new CustomEvent<ToggleZoneEventDetail>(TOGGLE_ZONE_EVENT, { detail: { zone } })
  );
}

export function subscribeToggleZoneRequests(
  listener: (zone: LayoutZone) => void
): () => void {
  const handler = (event: Event) => {
    const custom = event as CustomEvent<ToggleZoneEventDetail>;
    listener(custom.detail.zone);
  };
  window.addEventListener(TOGGLE_ZONE_EVENT, handler);
  return () => window.removeEventListener(TOGGLE_ZONE_EVENT, handler);
}
