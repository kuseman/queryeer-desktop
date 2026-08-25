import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const configuredConnectionsMock = vi.hoisted(() => vi.fn(() => [
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
]));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({
    invoke: invokeMock
  })
}));

vi.mock("./elasticsearch-settings", () => ({
  getConfiguredElasticsearchConnections: configuredConnectionsMock
}));

import { getPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderElasticsearchCatalogContribution } from "./elasticsearch-catalog-contribution";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("payloadbuilder elasticsearch catalog contribution", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    invokeMock.mockReset();
    configuredConnectionsMock.mockReset();
    configuredConnectionsMock.mockReturnValue([
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
    ]);
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
    expect(await contribution?.flowMappingFields?.[0]?.listOptions?.({})).toEqual([{
      value: "550e8400-e29b-41d4-a716-446655440100",
      label: "Cluster One"
    }]);
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

  it("ignores an out-of-order reload after switching connection, file, and alias", async () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "cluster-a",
        title: "Cluster A",
        endpoint: "https://a:9200",
        authType: "NONE",
        authUsername: "",
        authPassword: { secretRef: "" },
        enabled: true
      },
      {
        connectionId: "cluster-b",
        title: "Cluster B",
        endpoint: "https://b:9200",
        authType: "NONE",
        authUsername: "",
        authPassword: { secretRef: "" },
        enabled: true
      }
    ]);
    registerPayloadbuilderElasticsearchCatalogContribution();
    const renderPanel = getPayloadbuilderCatalogContribution("elasticsearch")?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected elasticsearch contribution renderPanel");
    }

    const responseA = deferred<{ indices: string[] }>();
    const responseB = deferred<{ indices: string[] }>();
    invokeMock.mockReturnValueOnce(responseA.promise).mockReturnValueOnce(responseB.promise);
    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(renderPanel({
        fileId: "file-a",
        alias: "es-a",
        catalogId: "elasticsearch",
        properties: { connectionId: "cluster-a" },
        setProperty: setPropertyMock
      }) as React.ReactElement);
      await flush();
    });
    await act(async () => {
      rootElement.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    await act(async () => {
      root.render(renderPanel({
        fileId: "file-b",
        alias: "es-b",
        catalogId: "elasticsearch",
        properties: { connectionId: "cluster-b" },
        setProperty: setPropertyMock
      }) as React.ReactElement);
      await flush();
    });
    expect((rootElement.querySelector("button") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      rootElement.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    await act(async () => {
      responseB.resolve({ indices: ["b-index"] });
      await flush();
      responseA.resolve({ indices: ["a-index"] });
      await flush();
    });

    expect(invokeMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      fileId: "file-b",
      payload: expect.objectContaining({
        alias: "es-b",
        properties: { connectionId: "cluster-b" }
      })
    }));
    const indexSelect = rootElement.querySelector("#payloadbuilder-es-index-es-b") as HTMLSelectElement;
    expect(Array.from(indexSelect.options).map((option) => option.value)).toEqual(["", "b-index"]);
    expect(setPropertyMock).toHaveBeenCalledWith("index", "b-index");
    expect(setPropertyMock).not.toHaveBeenCalledWith("index", "a-index");
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

  it("preserves selections when the persisted connection is temporarily unavailable", async () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "550e8400-e29b-41d4-a716-446655440100",
        title: "Cluster One",
        endpoint: "https://localhost:9200",
        authType: "NONE",
        authUsername: "",
        authPassword: { secretRef: "" },
        enabled: true
      },
      {
        connectionId: "cluster-disabled",
        title: "Disabled",
        endpoint: "https://disabled:9200",
        authType: "NONE",
        authUsername: "",
        authPassword: { secretRef: "" },
        enabled: false
      }
    ]);
    registerPayloadbuilderElasticsearchCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("elasticsearch");
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
          properties: { connectionId: "cluster-disabled", index: "old-*" },
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(setPropertyMock).not.toHaveBeenCalledWith("connectionId", "");
    expect(setPropertyMock).not.toHaveBeenCalledWith("index", "");
    expect(setPropertyMock).not.toHaveBeenCalledWith("connectionId", "550e8400-e29b-41d4-a716-446655440100");
    const connectionSelect = rootElement.querySelector("#payloadbuilder-es-connection-es1") as HTMLSelectElement;
    const indexSelect = rootElement.querySelector("#payloadbuilder-es-index-es1") as HTMLSelectElement;
    const options = Array.from(indexSelect.querySelectorAll("option")).map((option) => option.value);
    expect(connectionSelect.value).toBe("cluster-disabled");
    expect(indexSelect.value).toBe("old-*");
    expect(options).toContain("old-*");
  });

  it("does not resolve disabled elasticsearch connection into runtime properties", () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "cluster-disabled",
        title: "Disabled",
        endpoint: "https://disabled:9200",
        authType: "NONE",
        authUsername: "",
        authPassword: { secretRef: "" },
        enabled: false
      }
    ]);
    registerPayloadbuilderElasticsearchCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("elasticsearch");

    expect(contribution?.resolveRuntimeProperties?.({
      connectionId: "cluster-disabled",
      index: "old-*"
    })).toEqual({});
  });
});
