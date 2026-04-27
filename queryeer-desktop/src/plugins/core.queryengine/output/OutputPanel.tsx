import { useState, useEffect } from "react";
import type { OutputContext, OutputContributor } from "../../../contracts/extensions/OutputExtension";
import { getOutputRegistry } from "./OutputRegistry";

type Props = {
  context: OutputContext;
  selectedPrimaryId?: string | null;
  onSelectPrimary?: (id: string) => void;
  onExportOpen?: (exportPath: string) => void;
};

function resolvePrimary(
  contributors: OutputContributor[],
  features: string[] | null,
  selectedId: string | null | undefined
): OutputContributor | undefined {
  const primaries = contributors.filter((c) => c.mode === "primary");
  // If the user has a valid manual selection, honour it
  if (selectedId) {
    const selected = primaries.find((c) => c.id === selectedId);
    if (selected) return selected;
  }
  // Auto-resolve: highest-priority primary whose capability is in features,
  // or any primary when features are not yet known (null = still running).
  const eligible = features === null
    ? primaries
    : primaries.filter((c) => features.includes(c.capability));
  return eligible[0]; // already sorted by priority from getContributors()
}

export function OutputPanel({ context, selectedPrimaryId, onExportOpen }: Props): JSX.Element {
  const [contributors, setContributors] = useState<OutputContributor[]>(() =>
    getOutputRegistry().getContributors()
  );

  useEffect(() => {
    const registry = getOutputRegistry();
    setContributors(registry.getContributors());
    return registry.subscribe(() => {
      setContributors(registry.getContributors());
    });
  }, []);

  const primaryContributor = resolvePrimary(contributors, context.features, selectedPrimaryId);

  // Keep registry in sync with resolved primary so notifyChunkRows targets the right contributor
  useEffect(() => {
    getOutputRegistry().setSelectedPrimary(primaryContributor?.id ?? null);
  }, [primaryContributor?.id]);

  // Ad-hoc contributors: only shown after features resolve and their capability is present
  const adhocContributors = context.features !== null
    ? contributors.filter(
        (c) => c.mode === "adhoc" && context.features!.includes(c.capability)
      )
    : [];

  // Export affordance: find any result set that exceeded the row limit
  const limitedSets = context.resultSets.filter((rs) => rs.rowLimitExceeded);
  const exportPaths = limitedSets.map((rs) => rs.exportPath).filter(Boolean) as string[];
  const isExportPending = limitedSets.length > 0 && exportPaths.length < limitedSets.length;

  if (contributors.length === 0) {
    return <div className="query-output-panel query-output-empty">No output views registered.</div>;
  }

  return (
    <div className="query-output-panel">
      {(isExportPending || exportPaths.length > 0) && (
        <div className="query-output-export-banner">
          {isExportPending
            ? "Writing export file…"
            : exportPaths.map((p) => (
                <button
                  key={p}
                  className="query-output-export-open"
                  onClick={() => onExportOpen?.(p)}
                >
                  Open full export
                </button>
              ))}
        </div>
      )}

      <div className="query-output-primary">
        {primaryContributor
          ? primaryContributor.render(context)
          : <div className="query-output-empty">No output view available.</div>}
      </div>

      {adhocContributors.map((c) => (
        <div key={c.id} className="query-output-adhoc">
          <div className="query-output-adhoc-title">{c.title}</div>
          <div className="query-output-adhoc-content">{c.render(context)}</div>
        </div>
      ))}
    </div>
  );
}
