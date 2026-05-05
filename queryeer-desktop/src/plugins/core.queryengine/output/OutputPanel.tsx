import { useState, useEffect, useRef } from "react";
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
  const primaryHostRef = useRef<HTMLDivElement | null>(null);
  const pendingFocusPrimaryIdRef = useRef<string | null>(null);
  const lastSelectedPrimaryIdRef = useRef<string | null>(null);

  useEffect(() => {
    const registry = getOutputRegistry();
    setContributors(registry.getContributors());
    return registry.subscribe(() => {
      setContributors(registry.getContributors());
    });
  }, []);

  const effectiveSelectedPrimaryId = selectedPrimaryId ?? lastSelectedPrimaryIdRef.current;
  const primaryContributor = resolvePrimary(contributors, context.features, effectiveSelectedPrimaryId);
  const primaries = eligiblePrimaries(contributors, context.features);

  useEffect(() => {
    if (primaryContributor?.id) {
      lastSelectedPrimaryIdRef.current = primaryContributor.id;
    }
  }, [primaryContributor?.id]);

  const contextForPrimary = (contributor: OutputContributor): OutputContext => {
    const rowsTargetPrimaryId = context.rowsTargetPrimaryId ?? primaryContributor?.id ?? null;
    if (
      rowsTargetPrimaryId
      && contributor.id !== rowsTargetPrimaryId
      && contributor.capability === "rows"
    ) {
      return { ...context, resultSets: [] };
    }
    return context;
  };

  useEffect(() => {
    if (!primaryContributor?.id) return;
    if (pendingFocusPrimaryIdRef.current !== primaryContributor.id) return;
    pendingFocusPrimaryIdRef.current = null;

    const host = primaryHostRef.current;
    if (!host) return;
    const target = host.querySelector("[data-output-focus-target='true']") as HTMLElement | null;
    target?.focus({ preventScroll: true });
  }, [primaryContributor?.id]);

  useEffect(() => {
    pendingFocusPrimaryIdRef.current = null;
    lastSelectedPrimaryIdRef.current = null;
  }, [context.fileId]);

  const adhocContributors =
    context.features !== null
      ? contributors.filter(
          (c) => c.mode === "adhoc" && context.features!.includes(c.capability)
        )
      : [];

  const limitedSets = context.resultSets.filter((rs) => rs.rowLimitExceeded);
  const exportPaths = limitedSets.map((rs) => rs.exportPath).filter(Boolean) as string[];
  const isExportPending = limitedSets.length > 0 && exportPaths.length < limitedSets.length;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (context.state !== "running" || context.executionStartedAtMs == null) {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 500);
    return () => clearInterval(timer);
  }, [context.state, context.executionStartedAtMs]);

  const elapsedMs = context.state === "running" && context.executionStartedAtMs != null
    ? Math.max(0, nowMs - context.executionStartedAtMs)
    : (context.metrics?.durationMs ?? null);
  const rowCount = context.state === "completed"
    ? (context.metrics?.rowCount ?? context.fetchedRowCount)
    : context.fetchedRowCount;

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
            onClick={() => {
              pendingFocusPrimaryIdRef.current = c.id;
              onSelectPrimary?.(c.id);
            }}
          >
            {c.icon && <img src={c.icon} alt="" className="query-output-tab-icon" aria-hidden="true" />}
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

      <div className="query-output-primary" ref={primaryHostRef}>
        {primaries.length > 0
          ? primaries.map((contributor) => (
              <div
                key={contributor.id}
                style={{ display: contributor.id === primaryContributor?.id ? "block" : "none", height: "100%" }}
              >
                {contributor.render(contextForPrimary(contributor))}
              </div>
            ))
          : <div className="query-output-empty">No output view available.</div>}
      </div>

      {adhocContributors.map((c) => (
        <div key={c.id} className="query-output-adhoc">
          <div className="query-output-adhoc-title">{c.title}</div>
          <div className="query-output-adhoc-content">{c.render(context)}</div>
        </div>
      ))}

      <div className="query-output-status-bar">
        <span>State: {context.state}</span>
        <span>Rows fetched: {Math.max(0, rowCount).toLocaleString()}</span>
        <span>Elapsed: {elapsedMs != null ? `${elapsedMs}ms` : "-"}</span>
        {context.progress?.message && <span>{context.progress.message}</span>}
      </div>
    </div>
  );
}
