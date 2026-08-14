import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";

export type ContextMenuSurfaceItem = {
  id: string;
  label: string;
  info?: string;
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

type MenuNode =
  | { type: "item"; item: ContextMenuSurfaceItem }
  | { type: "parent"; label: string; children: ContextMenuSurfaceItem[] };

function buildMenuNodes(items: ContextMenuSurfaceItem[]): MenuNode[] {
  const parentMap = new Map<string, ContextMenuSurfaceItem[]>();
  const nodes: MenuNode[] = [];

  const unescape = (s: string) => s.replace(/\\\//g, "/");

  for (const item of items) {
    const slashIdx = findUnescapedSlash(item.label);
    if (slashIdx > 0) {
      const parent = unescape(item.label.slice(0, slashIdx));
      const childLabel = unescape(item.label.slice(slashIdx + 1));
      if (!parentMap.has(parent)) {
        parentMap.set(parent, []);
      }
      parentMap.get(parent)!.push({ ...item, label: childLabel });
    } else {
      nodes.push({ type: "item", item: { ...item, label: unescape(item.label) } });
    }
  }

  for (const [label, children] of parentMap) {
    nodes.push({ type: "parent", label, children });
  }

  return nodes;
}

/** Finds the first `/` not preceded by `\`. Returns -1 if none found. */
function findUnescapedSlash(label: string): number {
  for (let i = 0; i < label.length; i++) {
    if (label[i] === "/" && (i === 0 || label[i - 1] !== "\\")) {
      return i;
    }
  }
  return -1;
}

function SubMenu({
  items,
  parentRef,
  onClose,
}: {
  items: ContextMenuSurfaceItem[];
  parentRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
}): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = menuRef.current;
    const parent = parentRef.current;
    if (!el || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    let left = parentRect.right;
    let top = parentRect.top - 4;
    if (left + rect.width > window.innerWidth) {
      left = parentRect.left - rect.width;
    }
    if (top + rect.height > window.innerHeight) {
      top = Math.max(0, window.innerHeight - rect.height - 4);
    }
    setPos({ left, top });
  }, [items, parentRef]);

  return (
    <div
      ref={menuRef}
      className="shell-context-menu"
      style={{ left: pos.left, top: pos.top, position: "fixed" }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="shell-context-menu__item"
          disabled={item.disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (item.disabled) return;
            onClose();
            void item.onSelect();
          }}
        >
          <span className="shell-context-menu__item-label">{item.label}</span>
          {item.info && <span className="shell-context-menu__item-info" title={item.info} aria-label={item.info}>ⓘ</span>}
        </button>
      ))}
    </div>
  );
}

function MenuItem({
  node,
  onClose,
}: {
  node: MenuNode;
  onClose: () => void;
}): JSX.Element {
  const [subMenuVisible, setSubMenuVisible] = useState(false);
  const itemRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  if (node.type === "item") {
    return (
      <button
        ref={itemRef}
        type="button"
        className="shell-context-menu__item"
        disabled={node.item.disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (node.item.disabled) return;
          onClose();
          void node.item.onSelect();
        }}
      >
        <span className="shell-context-menu__item-label">{node.item.label}</span>
        {node.item.info && <span className="shell-context-menu__item-info" title={node.item.info} aria-label={node.item.info}>ⓘ</span>}
      </button>
    );
  }

  return (
    <div
      className="shell-context-menu__parent"
      onMouseEnter={() => {
        cancelClose();
        setSubMenuVisible(true);
      }}
      onMouseLeave={() => {
        closeTimerRef.current = setTimeout(() => setSubMenuVisible(false), 150);
      }}
    >
      <button
        ref={itemRef}
        type="button"
        className="shell-context-menu__item shell-context-menu__item--parent"
        onMouseDown={(e) => e.preventDefault()}
      >
        <span>{node.label}</span>
        <span className="shell-context-menu__arrow">▶</span>
      </button>
      {subMenuVisible && (
        <SubMenu
          items={node.children}
          parentRef={itemRef}
          onClose={onClose}
        />
      )}
    </div>
  );
}

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
            {buildMenuNodes(section).map((node) => (
              <MenuItem key={node.type === "item" ? node.item.id : `parent-${node.label}`} node={node} onClose={onClose} />
            ))}
          </div>
        ))
      )}
    </div>,
    document.body
  );
}
