import type { LayoutViewContribution, SidebarZone } from "../../contracts/extensions/LayoutExtension";

type SidebarProps = {
  views: LayoutViewContribution[];
  zone: SidebarZone;
  width: number;
};

export function Sidebar({ views, zone, width }: SidebarProps) {
  return (
    <aside
      className={`shell-sidebar shell-sidebar-${zone === "primarySidebar" ? "primary" : "secondary"}`}
      aria-label={zone === "primarySidebar" ? "Primary sidebar" : "Secondary sidebar"}
      style={{ width: `${width}px` }}
    >
      {views.map((view) => (
        <section key={view.id} className="panel-card">
          <h3>{view.title}</h3>
          {view.render()}
        </section>
      ))}
    </aside>
  );
}
