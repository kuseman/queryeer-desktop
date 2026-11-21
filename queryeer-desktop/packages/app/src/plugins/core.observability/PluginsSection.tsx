import { useMemo, useState } from "react";
import type { ContributionKind } from "../../core/plugin-runtime/ContributionOwnership";
import { Badge, ChipGroup, CopyButton, EmptyState, Icon, Mono, SearchInput, StatusDot, toneOfHealth, type Tone } from "./components";
import { CONTRIBUTION_KIND_LABELS, dependencyId, formatDuration, matchesQuery, type Contribution, type FrontendState, type PluginRow } from "./model";

export type PluginFilter = "all" | "problems" | "frontend" | "backend" | "feature";

const FRONTEND_TONES: Record<FrontendState, Tone> = {
  active: "ok",
  warning: "warning",
  skipped: "warning",
  failed: "error",
  "not-loaded": "neutral"
};

const BACKEND_TONES: Record<string, Tone> = {
  activated: "ok",
  loaded: "ok",
  skipped: "warning",
  failed: "error",
  deactivated: "neutral"
};

export function PluginsSection({
  rows,
  selectedId,
  onSelect,
  filter,
  onFilterChange
}: {
  rows: PluginRow[];
  selectedId: string | undefined;
  onSelect: (pluginId: string) => void;
  filter: PluginFilter;
  onFilterChange: (filter: PluginFilter) => void;
}) {
  const [query, setQuery] = useState("");

  const visible = useMemo(
    () =>
      rows.filter((row) => matchesPluginFilter(row, filter) && matchesQuery(query, row.name, row.id, row.description, row.modulePath)),
    [rows, filter, query]
  );
  const selected = rows.find((row) => row.id === selectedId) ?? visible[0];
  const problemCount = rows.filter((row) => row.health === "error" || row.health === "warning").length;

  return (
    <div className="obs-plugins">
      <div className="obs-toolbar">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter plugins" />
        <ChipGroup<PluginFilter>
          label="Plugin filter"
          value={filter}
          onChange={onFilterChange}
          options={[
            { value: "all", label: "All", count: rows.length },
            { value: "problems", label: "Problems", count: problemCount, tone: problemCount > 0 ? "error" : undefined },
            { value: "frontend", label: "Frontend", count: rows.filter((row) => row.frontend).length },
            { value: "backend", label: "Backend", count: rows.filter((row) => row.backend).length },
            { value: "feature", label: "Feature", count: rows.filter((row) => row.kind === "feature").length }
          ]}
        />
      </div>
      <div className="obs-master-detail">
        <div className="obs-master" role="listbox" aria-label="Plugins">
          {visible.length === 0 ? (
            <EmptyState icon={filter === "problems" ? "pass" : "search"} title={filter === "problems" ? "No plugin problems" : "No matching plugins"} />
          ) : (
            visible.map((row) => (
              <button
                key={row.id}
                type="button"
                role="option"
                aria-selected={row.id === selected?.id}
                className={`obs-plugin-item${row.id === selected?.id ? " obs-plugin-item-selected" : ""}`}
                onClick={() => onSelect(row.id)}
              >
                <StatusDot tone={toneOfHealth(row.health)} label={row.health} />
                <span className="obs-plugin-item-text">
                  <span className="obs-plugin-item-name">{row.name}</span>
                  <span className="obs-plugin-item-id">{row.id}</span>
                </span>
                <span className="obs-plugin-item-runtimes">
                  {row.frontend && <RuntimePill label="FE" tone={FRONTEND_TONES[row.frontend.state]} title={`Frontend: ${row.frontend.state}`} />}
                  {row.backend && <RuntimePill label="BE" tone={BACKEND_TONES[row.backend.state] ?? "neutral"} title={`Backend: ${row.backend.state}`} />}
                </span>
              </button>
            ))
          )}
        </div>
        <div className="obs-detail">
          {selected ? <PluginDetail row={selected} rows={rows} onSelect={onSelect} /> : <EmptyState icon="extensions" title="Select a plugin" />}
        </div>
      </div>
    </div>
  );
}

export function matchesPluginFilter(row: PluginRow, filter: PluginFilter): boolean {
  switch (filter) {
    case "problems":
      return row.health === "error" || row.health === "warning";
    case "frontend":
      return row.frontend !== undefined;
    case "backend":
      return row.backend !== undefined;
    case "feature":
      return row.kind === "feature";
    default:
      return true;
  }
}

function RuntimePill({ label, tone, title }: { label: string; tone: Tone; title: string }) {
  return (
    <span className={`obs-runtime-pill obs-tone-${tone}`} title={title}>
      {label}
    </span>
  );
}

function PluginDetail({ row, rows, onSelect }: { row: PluginRow; rows: PluginRow[]; onSelect: (pluginId: string) => void }) {
  const known = new Set(rows.map((candidate) => candidate.id));
  const dependents = rows.filter((candidate) => candidate.dependencies.some((dependency) => dependencyId(dependency) === row.id));
  const grouped = groupByKind(row.contributions);

  return (
    <article className="obs-plugin-detail" aria-label={`${row.name} details`}>
      <header className="obs-plugin-detail-header">
        <div>
          <h2>{row.name}</h2>
          <div className="obs-plugin-detail-meta">
            <Mono>{row.id}</Mono>
            {row.version && <Badge>v{row.version}</Badge>}
            {row.kind && <Badge tone={row.kind === "feature" ? "info" : "neutral"}>{row.kind}</Badge>}
          </div>
        </div>
        <CopyButton text={() => row.id} label="Copy id" />
      </header>
      {row.description && <p className="obs-plugin-detail-description">{row.description}</p>}

      <div className="obs-runtime-cards">
        <RuntimeCard
          title="Frontend"
          icon="browser"
          state={row.frontend?.state ?? "not present"}
          tone={row.frontend ? FRONTEND_TONES[row.frontend.state] : "neutral"}
          facts={[
            row.frontend?.activationIndex !== undefined ? `Activated #${row.frontend.activationIndex}` : undefined,
            row.frontend?.activationMs !== undefined ? `in ${formatDuration(row.frontend.activationMs)}` : undefined
          ]}
          messages={row.frontend?.messages ?? []}
        />
        <RuntimeCard
          title="Backend"
          icon="server-process"
          state={row.backend?.state ?? "not present"}
          tone={row.backend ? BACKEND_TONES[row.backend.state] ?? "neutral" : "neutral"}
          facts={[]}
          messages={row.backend?.reason ? [row.backend.reason] : []}
        />
      </div>

      <div className="obs-relations">
        <Relation title="Depends on" empty="No dependencies">
          {row.dependencies.map((dependency) => {
            const id = dependencyId(dependency);
            return (
              <PluginLink key={dependency} id={id} label={dependency} known={known.has(id)} onSelect={onSelect} />
            );
          })}
        </Relation>
        <Relation title="Required by" empty="Nothing depends on it">
          {dependents.map((dependent) => (
            <PluginLink key={dependent.id} id={dependent.id} label={dependent.id} known onSelect={onSelect} />
          ))}
        </Relation>
        <Relation title="Requires capabilities" empty="None">
          {row.requiredCapabilities.map((capability) => <Badge key={capability}>{capability}</Badge>)}
        </Relation>
        <Relation title="Provides capabilities" empty="None">
          {row.providedCapabilities.map((capability) => <Badge key={capability} tone="info">{capability}</Badge>)}
        </Relation>
      </div>

      <section className="obs-detail-section">
        <h3>
          Contributions <span className="obs-count">{row.contributions.length}</span>
        </h3>
        {row.contributions.length === 0 ? (
          <p className="obs-muted">
            {row.frontend?.state === "active" || row.frontend?.state === "warning"
              ? "This plugin registered no tracked contributions."
              : "Contributions are recorded for frontend plugins that activated."}
          </p>
        ) : (
          <div className="obs-contribution-groups">
            {grouped.map(([kind, items]) => (
              <details key={kind} className="obs-contribution-group" open={items.length <= 6}>
                <summary>
                  <Icon name="chevron-right" className="obs-disclosure" />
                  {CONTRIBUTION_KIND_LABELS[kind]}
                  <span className="obs-count">{items.length}</span>
                </summary>
                <ul>
                  {items.map((item) => (
                    <li key={item.id}>
                      <span className="obs-contribution-label">{item.label}</span>
                      <Mono>{item.id}</Mono>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        )}
      </section>

      {row.modulePath && (
        <section className="obs-detail-section">
          <h3>Module</h3>
          <Mono>{row.modulePath}</Mono>
        </section>
      )}
    </article>
  );
}

function RuntimeCard({
  title,
  icon,
  state,
  tone,
  facts,
  messages
}: {
  title: string;
  icon: string;
  state: string;
  tone: Tone;
  facts: (string | undefined)[];
  messages: string[];
}) {
  const shownFacts = facts.filter(Boolean).join(" ");
  return (
    <div className={`obs-runtime-card obs-runtime-card-${tone}`}>
      <div className="obs-runtime-card-head">
        <Icon name={icon} />
        <span>{title}</span>
        <Badge tone={tone}>{state}</Badge>
      </div>
      {shownFacts && <span className="obs-muted">{shownFacts}</span>}
      {messages.map((message, index) => (
        <p key={index} className="obs-runtime-message">
          {message}
        </p>
      ))}
    </div>
  );
}

function Relation({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div className="obs-relation">
      <span className="obs-relation-title">{title}</span>
      <div className="obs-relation-items">{children.length > 0 ? children : <span className="obs-muted">{empty}</span>}</div>
    </div>
  );
}

function PluginLink({ id, label, known, onSelect }: { id: string; label: string; known: boolean; onSelect: (id: string) => void }) {
  if (!known) {
    return <Badge title="Not installed">{label}</Badge>;
  }
  return (
    <button type="button" className="obs-link-chip" onClick={() => onSelect(id)}>
      {label}
    </button>
  );
}

function groupByKind(contributions: Contribution[]): [ContributionKind, Contribution[]][] {
  const groups = new Map<ContributionKind, Contribution[]>();
  for (const contribution of contributions) {
    groups.set(contribution.kind, [...(groups.get(contribution.kind) ?? []), contribution]);
  }
  return [...groups.entries()].sort(([a], [b]) => CONTRIBUTION_KIND_LABELS[a].localeCompare(CONTRIBUTION_KIND_LABELS[b]));
}
