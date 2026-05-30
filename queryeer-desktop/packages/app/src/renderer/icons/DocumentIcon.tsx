import type { JSX } from "react";
import type { MimeIconProps } from "@queryeer/api/files/FilesRegistry";

export function DocumentIcon({ className, style }: MimeIconProps): JSX.Element {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 2.5h5.2L12.5 6v9h-9z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M8.5 2.5V6H12" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M5.25 9.5h5.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}