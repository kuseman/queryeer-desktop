import type { JSX } from "react";
import type { MimeIconProps } from "@queryeer/api/files/FilesRegistry";

export function LetterPIcon({ className, style }: MimeIconProps): JSX.Element {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" aria-hidden="true">
      <rect x="2.5" y="2" width="11" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <text
        x="8"
        y="10.5"
        textAnchor="middle"
        fill="currentColor"
        fontSize="8"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        P
      </text>
    </svg>
  );
}