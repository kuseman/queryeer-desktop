import type { BackendGatewayStatus } from "@queryeer/api/backend";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { BACKEND_STATE_TONES } from "./BackendSection";
import { Icon, StatusDot } from "./components";
import type { AttentionItem, PluginRow, SectionId } from "./model";
import { revealInObservability, useObservabilityLocation } from "./navigation";
import { useObservabilityModel } from "./use-observability-model";

const NAV: { id: SectionId; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "dashboard" },
  { id: "plugins", label: "Plugins", icon: "extensions" },
  { id: "contributions", label: "Contributions", icon: "symbol-namespace" },
  { id: "engines", label: "Query engines", icon: "database" },
  { id: "backend", label: "Backend", icon: "server-process" }
];

/** The Observability sections, in the sidebar while the Observability tab is active. */
export function ObservabilityNav({ listFiles }: { listFiles: () => FileEntity[] }) {
  const location = useObservabilityLocation();
  const { rows, contributions, attention, backendStatus } = useObservabilityModel(listFiles);

  return (
    <nav className="obs-side-nav" aria-label="Observability sections">
      {NAV.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`obs-nav-item${location.section === item.id ? " obs-nav-item-active" : ""}`}
          aria-current={location.section === item.id ? "page" : undefined}
          onClick={() => revealInObservability({ section: item.id })}
        >
          <Icon name={item.icon} />
          <span className="obs-nav-label">{item.label}</span>
          <NavBadge section={item.id} rows={rows} contributions={contributions.length} attention={attention} backendStatus={backendStatus} />
        </button>
      ))}
    </nav>
  );
}

function NavBadge({
  section,
  rows,
  contributions,
  attention,
  backendStatus
}: {
  section: SectionId;
  rows: PluginRow[];
  contributions: number;
  attention: AttentionItem[];
  backendStatus: BackendGatewayStatus | null;
}) {
  if (section === "overview") {
    const worst = attention[0]?.severity;
    return worst && worst !== "info" ? <StatusDot tone={worst} label={`${attention.length} items need attention`} /> : null;
  }
  if (section === "plugins") {
    const problems = rows.filter((row) => row.health === "error" || row.health === "warning").length;
    return problems > 0 ? <span className="obs-nav-count obs-tone-error">{problems}</span> : <span className="obs-nav-count">{rows.length}</span>;
  }
  if (section === "contributions") {
    return <span className="obs-nav-count">{contributions}</span>;
  }
  if (section === "backend" && backendStatus) {
    return <StatusDot tone={BACKEND_STATE_TONES[backendStatus.state]} label={`Backend ${backendStatus.state}`} />;
  }
  return null;
}
