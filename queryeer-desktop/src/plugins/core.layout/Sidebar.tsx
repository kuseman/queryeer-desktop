import { useState, useEffect } from "react";
import type { LayoutViewContribution, SidebarZone } from "../../contracts/extensions/LayoutExtension";

type SidebarProps = {
  views: LayoutViewContribution[];
  zone: SidebarZone;
  width: number;
  panelStates?: Record<string, boolean>;
  onPanelStateChange?: (viewId: string, isOpen: boolean) => void;
};

export function Sidebar({ views, zone, width, panelStates = {}, onPanelStateChange }: SidebarProps) {
  return (
    <aside
      className={`shell-sidebar shell-sidebar-${zone === "primarySidebar" ? "primary" : "secondary"}`}
      aria-label={zone === "primarySidebar" ? "Primary sidebar" : "Secondary sidebar"}
      style={{ width: `${width}px` }}
    >
      {views.map((view) => (
        <CollapsiblePanel
          key={view.id}
          view={view}
          initialIsOpen={panelStates[view.id] ?? view.isOpen ?? true}
          onToggle={(isOpen) => onPanelStateChange?.(view.id, isOpen)}
        />
      ))}
    </aside>
  );
}

type CollapsiblePanelProps = {
  view: LayoutViewContribution;
  initialIsOpen: boolean;
  onToggle?: (isOpen: boolean) => void;
};

function CollapsiblePanel({ view, initialIsOpen, onToggle }: CollapsiblePanelProps) {
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

  return (
    <section className="panel-card">
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
      </header>
      {isOpen && <div className="panel-content">{view.render()}</div>}
    </section>
  );
}