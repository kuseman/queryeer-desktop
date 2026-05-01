import type { JSX } from "react";
import type { MimeIconProps } from "../../contracts/files/FilesRegistry";

export function DatabaseIcon({ className, style }: MimeIconProps): JSX.Element {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 2C4.13 2 1 2.83 1 4v8c0 1.17 3.13 2 7 2s7-.83 7-2V4c0-1.17-3.13-2-7-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path d="M1 6c0 1.17 3.13 2 7 2s7-.83 7-2" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M1 10c0 1.17 3.13 2 7 2s7-.83 7-2" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}