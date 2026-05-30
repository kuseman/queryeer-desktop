import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputContext, OutputContributor } from "@queryeer/api/queryengine/OutputExtension";

const mocks = vi.hoisted(() => {
  const contributors: OutputContributor[] = [];
  return {
    contributors,
    listeners: new Set<() => void>()
  };
});

vi.mock("./OutputRegistry", () => ({
  getOutputRegistry: () => ({
    getContributors: () => [...mocks.contributors],
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    }
  })
}));

import { OutputPanel } from "./OutputPanel";

void React;

const baseContext: OutputContext = {
  state: "completed",
  resultSets: [],
  output: [],
  features: ["rows"],
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

function makeContributor(id: string, title: string, capability: string, mode: "primary" | "adhoc"): OutputContributor {
  return {
    id,
    title,
    capability,
    mode,
    render: () => <div data-testid={`view-${id}`}>{title} view</div>
  };
}

describe("OutputPanel", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.contributors.length = 0;
    mocks.contributors.push(
      makeContributor("table", "Results", "rows", "primary"),
      makeContributor("text", "Text", "rows", "primary"),
      makeContributor("plan", "Plan", "plan", "adhoc")
    );
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

  it("keeps rows outputs available for plan-only completions", async () => {
    await act(async () => {
      root.render(<OutputPanel context={{ ...baseContext, features: ["plan"] }} />);
    });

    const tabs = [...rootElement.querySelectorAll(".query-output-tab")].map((tab) => tab.textContent);
    expect(tabs).toEqual(["Results", "Text", "Plan"]);
    expect(rootElement.textContent).not.toContain("No output view available");
  });

  it("excludes contributors with showInPanel=false from tabs", async () => {
    mocks.contributors.push(
      makeContributor("file-out", "File", "rows", "primary"),
    );
    // Set showInPanel=false on the last registered contributor
    const fileContrib = mocks.contributors.find((c) => c.id === "file-out");
    if (fileContrib) fileContrib.showInPanel = false;

    await act(async () => {
      root.render(<OutputPanel context={baseContext} />);
    });

    const tabs = [...rootElement.querySelectorAll(".query-output-tab")].map((tab) => tab.textContent);
    expect(tabs).not.toContain("File");
    expect(tabs).toEqual(["Results", "Text"]);
  });

  it("renders show-in-folder button in export banner", async () => {
    const onExportShowInFolder = vi.fn();
    await act(async () => {
      root.render(
        <OutputPanel
          context={{
            ...baseContext,
            resultSets: [{
              resultSetIndex: 0,
              schema: { columns: [] },
              rows: [],
              rowLimitExceeded: true,
              exportPath: "file:///C:/tmp/export.csv"
            }]
          }}
          onExportShowInFolder={onExportShowInFolder}
        />
      );
    });

    const showInFolderBtn = rootElement.querySelector(".query-output-export-show-folder");
    expect(showInFolderBtn).not.toBeNull();
    expect(showInFolderBtn?.textContent).toBe("Show in folder");
  });

  it("renders plan output as a selectable normal tab", async () => {
    const onSelectPrimary = vi.fn();

    await act(async () => {
      root.render(
        <OutputPanel
          context={{ ...baseContext, features: ["rows", "plan"] }}
          selectedPrimaryId="plan"
          onSelectPrimary={onSelectPrimary}
        />
      );
    });

    const active = rootElement.querySelector(".query-output-tab-active");
    expect(active?.textContent).toBe("Plan");

    const planView = rootElement.querySelector('[data-testid="view-plan"]');
    expect(planView?.parentElement?.className).toContain("query-output-view");
    expect((planView?.parentElement as HTMLElement | null)?.style.display).toBe("block");
    expect(rootElement.querySelector('[data-testid="view-table"]')).not.toBeNull();
  });
});
