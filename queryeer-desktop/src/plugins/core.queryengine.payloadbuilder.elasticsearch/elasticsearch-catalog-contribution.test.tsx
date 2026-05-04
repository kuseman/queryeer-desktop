import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({
    invoke: invokeMock
  })
}));

vi.mock("./elasticsearch-settings", () => ({
  getConfiguredElasticsearchConnections: () => [
    {
      connectionId: "550e8400-e29b-41d4-a716-446655440100",
      title: "Cluster One",
      endpoint: "https://localhost:9200",
      authType: "BASIC",
      authUsername: "elastic",
      authPassword: {
        secretRef: "secret-ref"
      },
      enabled: true
    }
  ]
}));

import { getPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderElasticsearchCatalogContribution } from "./elasticsearch-catalog-contribution";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("payloadbuilder elasticsearch catalog contribution", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    invokeMock.mockReset();
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      await flush();
    });
    rootElement.remove();
    vi.unstubAllGlobals();
  });

  it("registers elasticsearch panel and loads indices via invoke", async () => {
    registerPayloadbuilderElasticsearchCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("elasticsearch");
    expect(contribution).toBeDefined();
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected elasticsearch contribution renderPanel");
    }

    invokeMock.mockResolvedValue({ indices: ["logs-2026", "metrics-2026"] });

    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "es1",
          catalogId: "elasticsearch",
          properties: {
            connectionId: "550e8400-e29b-41d4-a716-446655440100"
          },
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    const button = rootElement.querySelector("button");
    expect(button?.textContent).toContain("Reload");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(invokeMock).toHaveBeenCalledWith({
      engineId: "payloadbuilder",
      fileId: "file-1",
      action: "payloadbuilder.es.listIndices",
      payload: {
        alias: "es1",
        properties: {
          connectionId: "550e8400-e29b-41d4-a716-446655440100"
        }
      }
    });

    const indexSelect = rootElement.querySelector("#payloadbuilder-es-index-es1") as HTMLSelectElement;
    const options = Array.from(indexSelect.querySelectorAll("option")).map((option) => option.value);
    expect(options).toEqual(["", "logs-2026", "metrics-2026"]);
    expect(setPropertyMock).toHaveBeenCalledWith("index", "logs-2026");
  });

  it("persists default connectionId when missing", async () => {
    registerPayloadbuilderElasticsearchCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("elasticsearch");
    expect(contribution).toBeDefined();
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected elasticsearch contribution renderPanel");
    }

    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "es1",
          catalogId: "elasticsearch",
          properties: {},
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(setPropertyMock).toHaveBeenCalledWith("connectionId", "550e8400-e29b-41d4-a716-446655440100");
  });
});
