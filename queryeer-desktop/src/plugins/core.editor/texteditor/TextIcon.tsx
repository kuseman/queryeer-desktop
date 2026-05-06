import type { JSX } from "react";
import type { MimeIconProps } from "../../../contracts/files/FilesRegistry";

export function TextIcon({ className, style }: MimeIconProps): JSX.Element {
  return (
    <svg className={className} style={style} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3 3h10v1.5H9V14H7V4.5H3V3z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}