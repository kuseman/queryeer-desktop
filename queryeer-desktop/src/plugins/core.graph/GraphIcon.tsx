export function GraphIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M4 3.5a2 2 0 1 1 2.45 1.95l1.34 2.01a2 2 0 0 1 .42 0l1.34-2.01A2 2 0 1 1 11 6a2 2 0 0 1-.58-.09L9.08 7.92a2 2 0 0 1 0 .16l1.34 2.01A2 2 0 1 1 9.55 11.1L8.21 9.09a2 2 0 0 1-.42 0L6.45 11.1A2 2 0 1 1 5 10a2 2 0 0 1 .58.09l1.34-2.01a2 2 0 0 1 0-.16L5.58 5.91A2 2 0 0 1 4 3.5Z" />
    </svg>
  );
}
