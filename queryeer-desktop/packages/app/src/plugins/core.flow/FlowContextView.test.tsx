import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowContextView } from "./FlowContextView";
import { getFlowStateStore } from "./flow-state";
import { parseQflowDocument } from "./qflow-parser";
import { clearFlowNodeTypeContributionsForTests, registerFlowNodeTypeContribution } from "./flow-node-type-contributions";

vi.mock("../core.commands/WhenExpressionEditor", () => ({
  WhenExpressionEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input
      data-testid="runif-editor"
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  )
}));

type ActiveEditor = {
  fileId: string;
} | null;

const mocks = vi.hoisted(() => {
  let activeEditor: ActiveEditor = null;
  const listeners = new Set<(editor: ActiveEditor) => void>();

  return {
    setActiveEditor(editor: ActiveEditor): void {
      activeEditor = editor;
      for (const listener of listeners) {
        listener(editor);
      }
    },
    host: {
      getActiveEditor: () => activeEditor,
      onActiveEditorChanged: (listener: (editor: ActiveEditor) => void) => {
        listeners.add(listener);
        return {
          dispose: () => {
            listeners.delete(listener);
          }
        };
      }
    },
    reset(): void {
      activeEditor = null;
      listeners.clear();
    }
  };
});

vi.mock("../../core/plugin-runtime/ExtensionRegistry", () => ({
  getEditorRegistryHost: () => mocks.host
}));

describe("FlowContextView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
    getFlowStateStore().clearAll();
    mocks.reset();
    clearFlowNodeTypeContributionsForTests();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    getFlowStateStore().clearAll();
    mocks.reset();
    clearFlowNodeTypeContributionsForTests();
  });

  it("renders node status section even before context is available", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: payloadbuilder.query",
      "%%",
      "select 2"
    ].join("\n"));

    getFlowStateStore().setDocument("flow-file", document);
    mocks.setActiveEditor({ fileId: "flow-file" });

    act(() => {
      root.render(<FlowContextView />);
    });

    const sectionHeaders = Array.from(container.querySelectorAll(".flow-context-section-header")).map(
      (element) => element.textContent?.trim()
    );
    expect(sectionHeaders).toContain("Active Node");
    expect(sectionHeaders).toContain("Node Status");

    const statusLabels = Array.from(container.querySelectorAll(".flow-context-node-list .flow-context-node-status")).map(
      (element) => element.textContent?.trim()
    );
    expect(statusLabels).toEqual(["not-run", "not-run"]);
  });

  it("renders compact node context tree for executed nodes", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));

    getFlowStateStore().setDocument("flow-file", document);
    getFlowStateStore().setExecution("flow-file", {
      mode: { kind: "all" },
      nodes: [
        {
          nodeId: "first",
          nodeType: "jdbc.query",
          status: "completed",
          output: {
            rowsAffected: 1,
            preview: "select 1"
          }
        }
      ],
      ctx: {
        first: {
          status: "completed",
          output: {
            rowsAffected: 1,
            rows: [{ a: 1 }]
          }
        }
      },
      stoppedOnFailure: false
    });
    mocks.setActiveEditor({ fileId: "flow-file" });

    act(() => {
      root.render(<FlowContextView />);
    });

    expect(container.textContent).toContain("Node Status");
    expect(container.textContent).toContain("first");
    expect(container.textContent).toContain("completed");
    expect(container.querySelector(".flow-context-compact-node")).not.toBeNull();
    expect(container.querySelector(".flow-context-raw-disclosure")?.hasAttribute("open")).toBe(false);
  });

  it("shows runIf editor and validation messages from core and contribution", () => {
    registerFlowNodeTypeContribution({
      id: "jdbc.query",
      title: "JDBC Query",
      execute: async () => ({ ok: true, output: { rowsAffected: 1 } }),
      validateConfiguration: () => [
        { field: "jdbc.connection", message: "Connection is required." }
      ]
    });

    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));

    getFlowStateStore().setDocument("flow-file", document);
    mocks.setActiveEditor({ fileId: "flow-file" });

    act(() => {
      root.render(<FlowContextView />);
    });

    expect(container.querySelector('[data-testid="runif-editor"]')).not.toBeNull();
    expect(container.textContent).toContain("Connection is required.");
  });
});
