import { useState, useRef, useCallback, useEffect } from "react";
import type { LayoutViewContribution, SidebarZone } from "../../contracts/extensions/LayoutExtension";

type SidebarProps = {
  views: LayoutViewContribution[];
  zone: SidebarZone;
  width: number;
  panelStates?: Record<string, boolean>;
  panelHeights?: Record<string, number>;
  onPanelStateChange?: (viewId: string, isOpen: boolean) => void;
  onPanelResize?: (viewId: string, height: number) => void;
  onExecuteCommand?: (commandId: string) => void;
};

export function Sidebar({
  views,
  zone,
  width,
  panelStates = {},
  panelHeights: initialHeights = {},
  onPanelStateChange,
  onPanelResize,
  onExecuteCommand
}: SidebarProps) {
  const [flexHeights, setFlexHeights] = useState<Record<string, number>>(initialHeights);
  const panelRefs = useRef<Map<string, HTMLElement>>(new Map());

  const startResize = useCallback(
    (e: React.MouseEvent, aboveViewId: string) => {
      e.preventDefault();
      const aboveView = views.find((v) => v.id === aboveViewId);
      if (!aboveView) return;

      const aboveEl = panelRefs.current.get(aboveViewId);
      const startY = e.clientY;
      const startHeight = aboveEl?.clientHeight ?? 200;
      const minH = aboveView.minHeight ?? 50;
      const maxH = aboveView.maxHeight ?? Infinity;

      setFlexHeights((prev) => ({ ...prev, [aboveViewId]: startHeight }));

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        setFlexHeights((prev) => ({
          ...prev,
          [aboveViewId]: Math.max(minH, Math.min(maxH, startHeight + delta))
        }));
      };

      const onUp = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        const final = Math.max(minH, Math.min(maxH, startHeight + delta));
        onPanelResize?.(aboveViewId, final);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("is-resizing-sidebar");
      };

      document.body.classList.add("is-resizing-sidebar");
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [views, onPanelResize]
  );

  return (
    <aside
      className={`shell-sidebar shell-sidebar-${zone === "primarySidebar" ? "primary" : "secondary"}`}
      aria-label={zone === "primarySidebar" ? "Primary sidebar" : "Secondary sidebar"}
      style={{ width: `${width}px` }}
    >
      {views.map((view, i) => {
        const prevView = views[i - 1];
        const prevIsFlexAndOpen =
          prevView?.flex != null &&
          (panelStates[prevView.id] ?? prevView.isOpen ?? true);

        const storedHeight = flexHeights[view.id];
        const panelStyle: React.CSSProperties | undefined =
          view.flex != null
            ? storedHeight != null
              ? { flex: "none", height: `${storedHeight}px` }
              : {
                  flex: view.flex,
                  minHeight: view.minHeight != null ? `${view.minHeight}px` : undefined,
                  maxHeight: view.maxHeight != null ? `${view.maxHeight}px` : undefined
                }
            : undefined;

        return (
          <CollapsiblePanel
            key={view.id}
            view={view}
            initialIsOpen={panelStates[view.id] ?? view.isOpen ?? true}
            isFlex={view.flex != null}
            panelStyle={panelStyle}
            sectionRef={(el) => {
              if (el) panelRefs.current.set(view.id, el);
              else panelRefs.current.delete(view.id);
            }}
            showResizeHandle={i > 0 && prevIsFlexAndOpen}
            onResizeHandleMouseDown={(e) => startResize(e, prevView!.id)}
            onToggle={(isOpen) => onPanelStateChange?.(view.id, isOpen)}
            onExecuteCommand={onExecuteCommand}
          />
        );
      })}
    </aside>
  );
}

type CollapsiblePanelProps = {
  view: LayoutViewContribution;
  initialIsOpen: boolean;
  isFlex: boolean;
  panelStyle?: React.CSSProperties;
  sectionRef?: (el: HTMLElement | null) => void;
  showResizeHandle?: boolean;
  onResizeHandleMouseDown?: (e: React.MouseEvent) => void;
  onToggle?: (isOpen: boolean) => void;
  onExecuteCommand?: (commandId: string) => void;
};

function CollapsiblePanel({
  view,
  initialIsOpen,
  isFlex,
  panelStyle,
  sectionRef,
  showResizeHandle,
  onResizeHandleMouseDown,
  onToggle,
  onExecuteCommand
}: CollapsiblePanelProps) {
  const [isOpen, setIsOpen] = useState(initialIsOpen);

  useEffect(() => {
    setIsOpen(initialIsOpen);
  }, [initialIsOpen]);

  const handleToggle = () => {
    if (view.canCollapse !== false) {
      setIsOpen(!isOpen);
      onToggle?.(!isOpen);
    }
  };

  const showToggle = view.canCollapse !== false;
  const effectiveStyle = isFlex && !isOpen ? { flex: "none" } : panelStyle;

  return (
    <section
      className={`panel-card${isFlex ? " panel-card-flex" : ""}`}
      style={effectiveStyle}
      ref={sectionRef}
    >
      {showResizeHandle && (
        <div className="sidebar-resize-handle" onMouseDown={onResizeHandleMouseDown} />
      )}
      <header
        className={`panel-header ${showToggle ? "panel-header-interactive" : ""}`}
        onClick={handleToggle}
        role={showToggle ? "button" : undefined}
        tabIndex={showToggle ? 0 : undefined}
        aria-expanded={isOpen}
      >
        {showToggle && (
          <span className={`panel-chevron ${isOpen ? "panel-chevron-open" : ""}`}>▶</span>
        )}
        <span className="panel-title">{view.title}</span>
        {view.panelActions && view.panelActions.length > 0 && (
          <div className="panel-actions">
            {view.panelActions.map((action) => (
              <button
                key={action.id}
                className="panel-action"
                title={action.title}
                onClick={(e) => {
                  e.stopPropagation();
                  onExecuteCommand?.(action.commandId);
                }}
              >
                {action.icon}
              </button>
            ))}
          </div>
        )}
      </header>
      {isOpen && <div className="panel-content">{view.render()}</div>}
    </section>
  );
}
