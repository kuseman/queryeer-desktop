type SidebarDividerProps = {
  target: "primary" | "secondary";
  onResize: (target: "primary" | "secondary") => void;
  label: string;
};

export function SidebarDivider({ target, onResize, label }: SidebarDividerProps) {
  return (
    <div
      className="shell-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onMouseDown={() => onResize(target)}
    />
  );
}