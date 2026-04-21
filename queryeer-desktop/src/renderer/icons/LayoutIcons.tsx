import type { JSX } from "react";

type IconProps = {
  className?: string;
};

export function PrimarySidebarIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <line x1="5.5" y1="2" x2="5.5" y2="14" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function SecondarySidebarIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="1.5"
        y="2"
        width="13"
        height="12"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <line x1="10.5" y1="2" x2="10.5" y2="14" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function GenericActionIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="8" cy="8" r="1.25" fill="currentColor" />
    </svg>
  );
}

export const layoutToolbarIconMap: Record<string, (props: IconProps) => JSX.Element> = {
  "sidebar-primary": PrimarySidebarIcon,
  "sidebar-secondary": SecondarySidebarIcon
};
