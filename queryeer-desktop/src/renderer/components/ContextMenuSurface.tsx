import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

export type ContextMenuSurfaceItem = {
  id: string;
  label: string;
  disabled?: boolean;
  onSelect: () => void | Promise<void>;
};

export type ContextMenuSurfaceProps = {
  x: number;
  y: number;
  sections: ContextMenuSurfaceItem[][];
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
  onClose: () => void;
};

export function ContextMenuSurface({
  x,
  y,
  sections,
  loading = false,
  loadingLabel = "Loading actions...",
  className = "",
  onClose,
}: ContextMenuSurfaceProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth) left = Math.max(0, window.innerWidth - rect.width - 4);
    if (top + rect.height > window.innerHeight) top = Math.max(0, window.innerHeight - rect.height - 4);
    setPos({ left, top });
  }, [x, y, sections, loading]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", handleKey, true);
    document.addEventListener("mousedown", handleDown, true);
    return () => {
      document.removeEventListener("keydown", handleKey, true);
      document.removeEventListener("mousedown", handleDown, true);
    };
  }, [onClose]);

  const nonEmpty = sections.filter((s) => s.length > 0);

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className={`shell-context-menu ${className}`.trim()}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {loading ? (
        <div className="shell-context-menu__loading" aria-busy="true">
          <span className="shell-context-menu__spinner" aria-hidden="true" />
          {loadingLabel}
        </div>
      ) : (
        nonEmpty.map((section, i) => (
          <div key={`section-${i}`}>
            {i > 0 && <div className="shell-context-menu__separator" />}
            {section.map((item) => (
              <button
                key={item.id}
                type="button"
                className="shell-context-menu__item"
                disabled={item.disabled}
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                onClick={() => {
                  if (item.disabled) return;
                  onClose();
                  void item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))
      )}
    </div>,
    document.body
  );
}
