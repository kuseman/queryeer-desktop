import type { QueryOutputArtifact } from "@queryeer/api/backend/Types";

export type PlanGraphArtifact = QueryOutputArtifact & {
  capability: "plan";
  kind: "graph";
};

type FilePlanArtifacts = {
  artifacts: PlanGraphArtifact[];
  updatedAtMs: number;
};

class QueryPlanArtifactStore {
  private readonly byFileId = new Map<string, FilePlanArtifacts>();

  rememberArtifacts(fileId: string, artifacts: QueryOutputArtifact[]): PlanGraphArtifact[] {
    const planArtifacts = artifacts.filter(isPlanGraphArtifact);
    if (planArtifacts.length === 0) {
      return [];
    }
    this.byFileId.set(fileId, {
      artifacts: [...planArtifacts],
      updatedAtMs: Date.now()
    });
    return planArtifacts;
  }

  list(fileId: string): PlanGraphArtifact[] {
    return [...(this.byFileId.get(fileId)?.artifacts ?? [])];
  }

  get(fileId: string, artifactId: string): PlanGraphArtifact | undefined {
    return this.byFileId.get(fileId)?.artifacts.find((artifact) => artifact.id === artifactId);
  }

  latest(fileId: string): PlanGraphArtifact | undefined {
    const artifacts = this.byFileId.get(fileId)?.artifacts;
    return artifacts && artifacts.length > 0 ? artifacts[artifacts.length - 1] : undefined;
  }

  clearFile(fileId: string): void {
    this.byFileId.delete(fileId);
  }

  pruneToFileIds(fileIds: Iterable<string>): void {
    const keep = new Set(fileIds);
    for (const fileId of this.byFileId.keys()) {
      if (!keep.has(fileId)) {
        this.byFileId.delete(fileId);
      }
    }
  }

  clear(): void {
    this.byFileId.clear();
  }
}

const artifactStore = new QueryPlanArtifactStore();

export function getQueryPlanArtifactStore(): QueryPlanArtifactStore {
  return artifactStore;
}

export function queryCompletedArtifacts(params: unknown): QueryOutputArtifact[] {
  const record = params !== null && typeof params === "object"
    ? params as { artifacts?: unknown }
    : {};
  return Array.isArray(record.artifacts)
    ? record.artifacts.filter(isQueryOutputArtifact)
    : [];
}

function isQueryOutputArtifact(value: unknown): value is QueryOutputArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const artifact = value as Partial<QueryOutputArtifact>;
  return typeof artifact.id === "string"
    && typeof artifact.capability === "string"
    && artifact.kind === "graph"
    && Boolean(artifact.graph)
    && typeof artifact.graph === "object";
}

export function isPlanGraphArtifact(value: QueryOutputArtifact): value is PlanGraphArtifact {
  return value.capability === "plan"
    && value.kind === "graph"
    && Boolean(value.graph)
    && typeof value.graph === "object";
}
