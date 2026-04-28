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

export function FileOpenIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 4.5C2 3.67 2.67 3 3.5 3h2.33c.49 0 .96.2 1.3.55l1.15 1.2c.15.15.35.25.56.25h3.66c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path d="M8 7.25v4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M6.25 9h3.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function FileNewIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 2.5h5.2L12.5 6v7.5h-9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M8.5 2.5V6H12" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M5.25 10h4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M7.5 7.75v4.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

export function FileSaveIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 2.5h9.2l.8.8V13.5h-10z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <rect x="5" y="2.5" width="5" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="5" y="9" width="6" height="3" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export const layoutToolbarIconMap: Record<string, (props: IconProps) => JSX.Element> = {
  "sidebar-primary": PrimarySidebarIcon,
  "sidebar-secondary": SecondarySidebarIcon,
  "file-open": FileOpenIcon,
  "file-new": FileNewIcon,
  "file-save": FileSaveIcon
};
