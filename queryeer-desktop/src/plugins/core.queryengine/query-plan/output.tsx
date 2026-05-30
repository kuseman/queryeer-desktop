import { useEffect, useMemo, useState } from "react";
import type { OutputContext } from "../../../contracts/queryengine/OutputExtension";
import type { PluginContext } from "../../../contracts/plugin/Plugin";
import { GraphViewer } from "../../core.graph/GraphViewer";
import { getOutputRegistry } from "../output/OutputRegistry";
import { QUERY_PLAN_OUTPUT_ID } from "./constants";
import { createQueryPlanAssistantContextContributions, createQueryPlanAssistantTools } from "./assistant-tools";
import { getQueryPlanInteractionStore } from "./interaction-store";
import { resolveQueryPlanOperatorIcon } from "./icons";
import outputGraphIconUrl from "./output.svg";
import "./output.css";

const artifactViewStateIds = new WeakMap<object, number>();
let nextArtifactViewStateId = 1;

function getArtifactViewStateKey(context: OutputContext, artifact: OutputContext["artifacts"][number]): string {
  // Plan graph ids are deterministic per statement, so object identity separates executions.
  let instanceId = artifactViewStateIds.get(artifact);
  if (instanceId === undefined) {
    instanceId = nextArtifactViewStateId++;
    artifactViewStateIds.set(artifact, instanceId);
  }
  return ["query-plan", context.fileId ?? "unknown-file", artifact.id, artifact.graph.id, instanceId].join(":");
}

export function registerQueryPlanOutput(context: PluginContext): void {
  const queryPlanInteractionStore = getQueryPlanInteractionStore();

  for (const contribution of createQueryPlanAssistantContextContributions(context)) {
    context.assistant.registerContextContribution(contribution);
  }
  for (const tool of createQueryPlanAssistantTools(context)) {
    context.assistant.registerToolContribution(tool);
  }

  getOutputRegistry().register({
    id: QUERY_PLAN_OUTPUT_ID,
    capability: "plan",
    mode: "adhoc",
    title: "Plan",
    icon: outputGraphIconUrl,
    priority: 50,
    render: (outputContext) => <QueryPlanGraphOutput context={outputContext} interactionStore={queryPlanInteractionStore} />
  });
}

function QueryPlanGraphOutput({
  context,
  interactionStore
}: {
  context: OutputContext;
  interactionStore: ReturnType<typeof getQueryPlanInteractionStore>;
}): JSX.Element {
  const artifacts = useMemo(
    () => context.artifacts.filter((candidate) => candidate.kind === "graph" && candidate.capability === "plan"),
    [context.artifacts]
  );
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const selectedArtifact = artifacts.find((artifact) => artifact.id === selectedArtifactId) ?? artifacts[0];

  useEffect(() => {
    if (artifacts.length === 0) {
      setSelectedArtifactId(null);
      return;
    }
    if (!selectedArtifactId || !artifacts.some((artifact) => artifact.id === selectedArtifactId)) {
      setSelectedArtifactId(artifacts[0]!.id);
    }
  }, [artifacts, selectedArtifactId]);

  if (!selectedArtifact) {
    return <div className="graph-output-empty">Query plan feature was reported, but no graph artifact was provided.</div>;
  }

  const viewer = (
    <GraphViewer
      graph={selectedArtifact.graph}
      viewStateKey={getArtifactViewStateKey(context, selectedArtifact)}
      iconResolver={resolveQueryPlanOperatorIcon}
      interactionStore={interactionStore}
    />
  );

  if (artifacts.length === 1) {
    return viewer;
  }

  return (
    <div className="graph-plan-output">
      <div className="graph-plan-list" aria-label="Query plans">
        <span className="graph-plan-list-label">Plans</span>
        {artifacts.map((artifact, index) => (
          <button
            key={artifact.id}
            type="button"
            className={`graph-plan-list-item${artifact.id === selectedArtifact.id ? " is-selected" : ""}`}
            title={artifact.title}
            onClick={() => setSelectedArtifactId(artifact.id)}
          >
            {`Statement ${index + 1}`}
          </button>
        ))}
      </div>
      <div className="graph-plan-view">
        <GraphViewer
          key={selectedArtifact.id}
          graph={selectedArtifact.graph}
          viewStateKey={getArtifactViewStateKey(context, selectedArtifact)}
          iconResolver={resolveQueryPlanOperatorIcon}
          interactionStore={interactionStore}
        />
      </div>
    </div>
  );
}
