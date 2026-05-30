import type { JSX } from "react";
import type { MimeIconProps } from "@queryeer/api/files/FilesRegistry";

export function FlowIcon({ className, style }: MimeIconProps): JSX.Element {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3 4.25h3v2.5H3v-2.5Zm7 0h3v2.5h-3v-2.5Zm-3.5 5h3v2.5h-3v-2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M6 5.5h4M8 6v2.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}
