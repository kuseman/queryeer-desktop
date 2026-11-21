import { useMemo, useState } from "react";
import type { ContributionKind } from "../../core/plugin-runtime/ContributionOwnership";
import type { KeybindingDiagnostics } from "../core.commands/keybinding-resolver";
import { Card, ChipGroup, EmptyState, Mono, SearchInput, type ChipOption } from "./components";
import { CONTRIBUTION_KIND_LABELS, matchesQuery, type Contribution } from "./model";

/** Above this, the table shows the first rows and asks for a narrower filter, so the view stays responsive. */
const ROW_LIMIT = 500;

export function ContributionsSection({
  contributions,
  keybindingDiagnostics,
  onSelectPlugin
}: {
  contributions: Contribution[];
  keybindingDiagnostics: KeybindingDiagnostics;
  onSelectPlugin: (pluginId: string) => void;
}) {
  const [kind, setKind] = useState<ContributionKind | "all">("all");
  const [query, setQuery] = useState("");

  const kindOptions = useMemo(() => {
    const counts = new Map<ContributionKind, number>();
    for (const contribution of contributions) {
      counts.set(contribution.kind, (counts.get(contribution.kind) ?? 0) + 1);
    }
    const options: ChipOption<ContributionKind | "all">[] = [{ value: "all", label: "All", count: contributions.length }];
    for (const [value, count] of [...counts.entries()].sort(([a], [b]) => CONTRIBUTION_KIND_LABELS[a].localeCompare(CONTRIBUTION_KIND_LABELS[b]))) {
      options.push({ value, label: CONTRIBUTION_KIND_LABELS[value], count });
    }
    return options;
  }, [contributions]);

  const visible = useMemo(
    () =>
      contributions
        .filter((contribution) => (kind === "all" || contribution.kind === kind) && matchesQuery(query, contribution.label, contribution.id, contribution.detail, contribution.ownerId))
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)),
    [contributions, kind, query]
  );
  const unattributed = contributions.filter((contribution) => !contribution.ownerId).length;
  const { invalidUserBindings, duplicateBindings } = keybindingDiagnostics;

  return (
    <div className="obs-stack">
      <div className="obs-toolbar obs-toolbar-wrap">
        <SearchInput value={query} onChange={setQuery} placeholder="Filter by label, id, plugin or detail" />
        <ChipGroup label="Contribution kind" value={kind} onChange={setKind} options={kindOptions} />
      </div>

      <Card flush>
        {visible.length === 0 ? (
          <EmptyState icon="search" title="No matching contributions" />
        ) : (
          <div className="obs-table-scroll">
            <table className="obs-table obs-contributions-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Label</th>
                  <th>Id</th>
                  <th>Plugin</th>
                  <th className="obs-col-detail">Detail</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, ROW_LIMIT).map((contribution) => (
                  <tr key={`${contribution.kind}:${contribution.id}`}>
                    <td className="obs-nowrap obs-muted">{CONTRIBUTION_KIND_LABELS[contribution.kind]}</td>
                    <td>{contribution.label}</td>
                    <td>
                      <Mono>{contribution.id}</Mono>
                    </td>
                    <td className="obs-nowrap">
                      {contribution.ownerId ? (
                        <button type="button" className="obs-link" onClick={() => onSelectPlugin(contribution.ownerId!)}>
                          {contribution.ownerId}
                        </button>
                      ) : (
                        <span className="obs-muted" title="Registered outside a plugin's context">
                          shell
                        </span>
                      )}
                    </td>
                    <td className="obs-muted obs-break">{contribution.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="obs-table-footer">
          {visible.length > ROW_LIMIT
            ? `Showing ${ROW_LIMIT} of ${visible.length}. Narrow the filter to see more.`
            : `${visible.length} of ${contributions.length} contributions`}
          {unattributed > 0 && ` · ${unattributed} registered by the shell`}
        </footer>
      </Card>

      {(invalidUserBindings.length > 0 || duplicateBindings.length > 0) && (
        <Card title="Keybinding diagnostics" icon="keyboard" flush>
          <div className="obs-table-scroll">
            <table className="obs-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Issue</th>
                  <th>Command</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {invalidUserBindings.map((binding, index) => (
                  <tr key={`invalid-${index}`}>
                    <td>
                      <Mono>{binding.key}</Mono>
                    </td>
                    <td className="obs-tone-text-warning">{binding.reason === "unknown-command" ? "Unknown command" : "Invalid key"}</td>
                    <td>
                      <Mono>{binding.commandId}</Mono>
                    </td>
                    <td />
                  </tr>
                ))}
                {duplicateBindings.map((duplicate, index) => (
                  <tr key={`duplicate-${index}`}>
                    <td>
                      <Mono>{duplicate.key}</Mono>
                    </td>
                    <td className="obs-muted">Shadows {duplicate.shadowedCommandId}</td>
                    <td>
                      <Mono>{duplicate.winnerCommandId}</Mono>
                    </td>
                    <td className="obs-muted">{duplicate.when ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
