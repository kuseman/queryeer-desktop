import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import type { ContextMenuItem } from "../../../contracts/extensions/ContextMenuExtension";

void React;

export type EditorContextMenuProps = {
  x: number;
  y: number;
  sections: ContextMenuItem[][];
  loading?: boolean;
  onClose: () => void;
};

export function EditorContextMenu({ x, y, sections, loading = false, onClose }: EditorContextMenuProps): JSX.Element {
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
  }, [x, y, sections]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
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

  const nonEmpty = sections.filter(s => s.length > 0);

  return ReactDOM.createPortal(
    <div
      ref={menuRef}
      className="editor-context-menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {loading ? (
        <div className="editor-context-menu__loading" aria-busy="true">
          <span className="editor-context-menu__spinner" aria-hidden="true" />
          Loading actions...
        </div>
      ) : (
        nonEmpty.map((section, i) => (
          <React.Fragment key={i}>
            {i > 0 && <div className="editor-context-menu__separator" />}
            {section.map((item) => (
              <div
                key={item.id}
                className="editor-context-menu__item"
                onMouseDown={(e) => { e.preventDefault(); onClose(); item.run(); }}
              >
                {item.label}
              </div>
            ))}
          </React.Fragment>
        ))
      )}
    </div>,
    document.body
  );
}
