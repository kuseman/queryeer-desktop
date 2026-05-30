import { beforeEach, describe, expect, it } from "vitest";
import type { QueryOutputArtifact } from "@queryeer/api/backend/Types";
import { getQueryPlanArtifactStore, queryCompletedArtifacts } from "./artifact-store";

function createArtifact(id: string, capability: string, kind: "graph" = "graph"): QueryOutputArtifact {
  return {
    id,
    capability,
    kind,
    title: `${capability}-${id}`,
    graph: {
      id: `${id}-graph`,
      vertices: [{ id: "v1", label: "Scan" }],
      edges: []
    }
  };
}

describe("query plan artifact store", () => {
  beforeEach(() => {
    getQueryPlanArtifactStore().clear();
  });

  it("stores only plan graph artifacts per file", () => {
    const store = getQueryPlanArtifactStore();
    const stored = store.rememberArtifacts("file-1", [
      createArtifact("a1", "rows"),
      createArtifact("p1", "plan"),
      createArtifact("p2", "plan")
    ]);

    expect(stored.map((artifact) => artifact.id)).toEqual(["p1", "p2"]);
    expect(store.list("file-1").map((artifact) => artifact.id)).toEqual(["p1", "p2"]);
    expect(store.latest("file-1")?.id).toBe("p2");
  });

  it("keeps artifacts isolated by file and supports prune", () => {
    const store = getQueryPlanArtifactStore();
    store.rememberArtifacts("file-a", [createArtifact("a", "plan")]);
    store.rememberArtifacts("file-b", [createArtifact("b", "plan")]);

    expect(store.get("file-a", "a")?.id).toBe("a");
    expect(store.get("file-b", "b")?.id).toBe("b");

    store.pruneToFileIds(["file-b"]);

    expect(store.list("file-a")).toEqual([]);
    expect(store.list("file-b").map((artifact) => artifact.id)).toEqual(["b"]);
  });

  it("parses completed event artifacts defensively", () => {
    expect(queryCompletedArtifacts(undefined)).toEqual([]);
    expect(queryCompletedArtifacts({ artifacts: [null, { id: "bad" }, createArtifact("p1", "plan")] }).map((artifact) => artifact.id)).toEqual(["p1"]);
  });
});
