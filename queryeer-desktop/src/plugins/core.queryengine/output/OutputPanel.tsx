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
  if (selectedId) {
    const selected = primaries.find((c) => c.id === selectedId);
    if (selected) return selected;
  }
  const eligible =
    features === null
      ? primaries
      : primaries.filter((c) => features.includes(c.capability));
  return eligible[0];
}

function eligiblePrimaries(
  contributors: OutputContributor[],
  features: string[] | null
): OutputContributor[] {
  const primaries = contributors.filter((c) => c.mode === "primary");
  return features === null ? primaries : primaries.filter((c) => features.includes(c.capability));
}

export function OutputPanel({ context, selectedPrimaryId, onSelectPrimary, onExportOpen }: Props): JSX.Element {
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
  const primaries = eligiblePrimaries(contributors, context.features);

  useEffect(() => {
    getOutputRegistry().setSelectedPrimary(primaryContributor?.id ?? null);
  }, [primaryContributor?.id]);

  const adhocContributors =
    context.features !== null
      ? contributors.filter(
          (c) => c.mode === "adhoc" && context.features!.includes(c.capability)
        )
      : [];

  const limitedSets = context.resultSets.filter((rs) => rs.rowLimitExceeded);
  const exportPaths = limitedSets.map((rs) => rs.exportPath).filter(Boolean) as string[];
  const isExportPending = limitedSets.length > 0 && exportPaths.length < limitedSets.length;

  if (contributors.length === 0) {
    return <div className="query-output-panel query-output-empty">No output views registered.</div>;
  }

  return (
    <div className="query-output-panel">
      <div className="query-output-tabs">
        {primaries.map((c) => (
          <button
            key={c.id}
            className={`query-output-tab${c.id === primaryContributor?.id ? " query-output-tab-active" : ""}`}
            onClick={() => onSelectPrimary?.(c.id)}
          >
            {c.title}
          </button>
        ))}
      </div>

      {(isExportPending || exportPaths.length > 0) && (
        <div className="query-output-export-banner">
          {isExportPending
            ? "Writing export file…"
            : exportPaths.map((p) => (
                <button key={p} className="query-output-export-open" onClick={() => onExportOpen?.(p)}>
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
