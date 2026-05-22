import type { QueryRequestedArtifact } from "../../../contracts/backend/Types";

export const QUERY_PLAN_OUTPUT_ID = "core.graph.queryPlanOutput";

export const QUERY_PLAN_ARTIFACT_REQUEST: QueryRequestedArtifact[] = [
  { capability: "plan", kind: "graph" }
];
