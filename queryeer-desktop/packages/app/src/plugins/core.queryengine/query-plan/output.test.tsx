import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputContext, OutputContributor } from "@queryeer/api/queryengine/OutputExtension";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";

const outputRegistryMock = vi.hoisted(() => ({
  register: vi.fn()
}));

vi.mock("../output/OutputRegistry", () => ({
  getOutputRegistry: () => outputRegistryMock
}));

vi.mock("../../core.graph/GraphViewer", () => ({
  GraphViewer: ({ graph, viewStateKey }: { graph: { id: string }; viewStateKey?: string }) => (
    <div data-testid="mock-graph-viewer" data-view-state-key={viewStateKey}>{graph.id}</div>
  )
}));

import { registerQueryPlanOutput } from "./output";

void React;

const baseOutputContext: OutputContext = {
  state: "completed",
  resultSets: [],
  output: [],
  features: ["rows", "plan"],
  artifacts: [],
  metrics: null,
  error: null,
  progress: null,
  fetchedRowCount: 0,
  executionStartedAtMs: null,
  textOutputFormat: "plain",
  rowsTargetPrimaryId: null,
  fileId: "file-1"
};

function makePluginContext(): PluginContext {
  return {
    assistant: {
      registerContextContribution: vi.fn(() => () => {}),
      registerToolContribution: vi.fn(() => () => {}),
      collectContext: vi.fn(async () => []),
      listTools: vi.fn(() => []),
      invokeTool: vi.fn(async () => ({ ok: false }))
    }
  } as unknown as PluginContext;
}

describe("query plan output registration", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    outputRegistryMock.register.mockClear();
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("registers assistant contributions and query plan output contributor", () => {
    const context = makePluginContext();
    registerQueryPlanOutput(context);

    expect(context.assistant.registerContextContribution).toHaveBeenCalled();
    expect(context.assistant.registerToolContribution).toHaveBeenCalled();
    expect(outputRegistryMock.register).toHaveBeenCalledWith(expect.objectContaining({
      id: "core.graph.queryPlanOutput",
      capability: "plan"
    }));
  });

  it("shows a compact selector for multiple plan artifacts", async () => {
    const context = makePluginContext();
    registerQueryPlanOutput(context);

    const contributor = outputRegistryMock.register.mock.calls
      .map((call) => call[0] as OutputContributor)
      .find((candidate) => candidate.id === "core.graph.queryPlanOutput");
    expect(contributor).toBeDefined();

    await act(async () => {
      root.render(<>{contributor!.render({
        ...baseOutputContext,
        artifacts: [
          {
            id: "plan-1",
            capability: "plan",
            kind: "graph",
            title: "Actual Query Plan",
            graph: { id: "graph-1", vertices: [{ id: "a", label: "A" }], edges: [] }
          },
          {
            id: "plan-2",
            capability: "plan",
            kind: "graph",
            title: "Actual Query Plan",
            graph: { id: "graph-2", vertices: [{ id: "b", label: "B" }], edges: [] }
          }
        ]
      })}</>);
    });

    expect(rootElement.textContent).toContain("Plans");
    expect(rootElement.textContent).toContain("Statement 1");
    expect(rootElement.textContent).toContain("graph-1");

    await act(async () => {
      (rootElement.querySelectorAll(".graph-plan-list-item")[1] as HTMLButtonElement).click();
    });

    expect(rootElement.textContent).toContain("graph-2");
  });

  it("uses a fresh graph view state key for each plan artifact instance", async () => {
    const context = makePluginContext();
    registerQueryPlanOutput(context);

    const contributor = outputRegistryMock.register.mock.calls
      .map((call) => call[0] as OutputContributor)
      .find((candidate) => candidate.id === "core.graph.queryPlanOutput");
    expect(contributor).toBeDefined();

    const artifact = {
      id: "plan-1",
      capability: "plan",
      kind: "graph" as const,
      title: "Actual Query Plan",
      graph: { id: "postgres-plan-1", vertices: [{ id: "a", label: "A" }], edges: [] }
    };

    await act(async () => {
      root.render(<>{contributor!.render({
        ...baseOutputContext,
        artifacts: [artifact]
      })}</>);
    });

    const firstKey = rootElement.querySelector("[data-testid='mock-graph-viewer']")?.getAttribute("data-view-state-key");
    expect(firstKey).toMatch(/^query-plan:file-1:plan-1:postgres-plan-1:\d+$/);

    await act(async () => {
      root.render(<>{contributor!.render({
        ...baseOutputContext,
        artifacts: [{
          ...artifact,
          graph: { id: "postgres-plan-1", vertices: [{ id: "b", label: "B" }], edges: [] }
        }]
      })}</>);
    });

    const secondKey = rootElement.querySelector("[data-testid='mock-graph-viewer']")?.getAttribute("data-view-state-key");
    expect(secondKey).toMatch(/^query-plan:file-1:plan-1:postgres-plan-1:\d+$/);
    expect(secondKey).not.toBe(firstKey);
  });
});
