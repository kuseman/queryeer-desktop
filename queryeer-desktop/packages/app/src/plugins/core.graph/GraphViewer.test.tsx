import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GraphDocument } from "@queryeer/api/graph";

vi.mock("@xyflow/react", () => ({
  Background: () => null,
  Controls: () => null,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  MiniMap: () => null,
  Position: {
    Bottom: "bottom",
    Left: "left",
    Right: "right",
    Top: "top"
  },
  ReactFlow: ({ children, onInit }: { children: React.ReactNode; onInit?: (instance: { setViewport: () => void; fitView: () => void }) => void }) => {
    useEffect(() => {
      onInit?.({ setViewport: vi.fn(), fitView: vi.fn() });
    }, [onInit]);
    return <div data-testid="react-flow">{children}</div>;
  },
  getViewportForBounds: () => ({ x: 0, y: 0, zoom: 1 })
}));

import { GraphViewer } from "./GraphViewer";

void React;

const graph: GraphDocument = {
  id: "graph-1",
  vertices: [{ id: "v1", label: "Vertex 1" }],
  edges: []
};

class MockResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(_target: Element, _options?: ResizeObserverOptions): void {}
  unobserve(_target: Element): void {}
  disconnect(): void {}
}

describe("GraphViewer", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver = MockResizeObserver;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
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

  it("can start with the properties panel collapsed", async () => {
    await act(async () => {
      root.render(<GraphViewer graph={graph} initialPropertiesPanelCollapsed />);
    });

    expect(rootElement.querySelector(".graph-properties")).toBeNull();
    expect(rootElement.querySelector(".graph-properties-toggle")?.textContent).toBe("Properties");
  });
});
