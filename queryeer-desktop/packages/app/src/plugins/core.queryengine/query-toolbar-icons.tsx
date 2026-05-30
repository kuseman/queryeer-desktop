import type { JSX } from "react";

type IconProps = {
  className?: string;
};

export function QueryRunIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M5 3.75L12 8L5 12.25z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}

export function QueryStopIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="4.25" y="4.25" width="7.5" height="7.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}
