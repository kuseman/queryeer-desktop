import { useState, useEffect } from "react";
import type { OutputContext, OutputContributor } from "./OutputRegistry";
import { getOutputRegistry } from "./OutputRegistry";

type Props = {
  context: OutputContext;
};

export function OutputPanel({ context }: Props): JSX.Element {
  const [contributors, setContributors] = useState<OutputContributor[]>(() =>
    getOutputRegistry().getContributors()
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  useEffect(() => {
    const registry = getOutputRegistry();
    setContributors(registry.getContributors());
    return registry.subscribe(() => {
      setContributors(registry.getContributors());
    });
  }, []);

  useEffect(() => {
    if (contributors.length > 0 && !activeTabId) {
      setActiveTabId(contributors[0].id);
    }
  }, [contributors, activeTabId]);

  if (contributors.length === 0) {
    return <div className="query-output-panel query-output-empty">No output views registered.</div>;
  }

  const activeContributor = contributors.find((c) => c.id === activeTabId) ?? contributors[0];

  return (
    <div className="query-output-panel">
      <div className="query-output-tabs">
        {contributors.map((c) => (
          <button
            key={c.id}
            className={`query-output-tab${c.id === activeContributor.id ? " query-output-tab-active" : ""}`}
            onClick={() => setActiveTabId(c.id)}
          >
            {c.title}
          </button>
        ))}
      </div>
      <div className="query-output-content">{activeContributor.render(context)}</div>
    </div>
  );
}
