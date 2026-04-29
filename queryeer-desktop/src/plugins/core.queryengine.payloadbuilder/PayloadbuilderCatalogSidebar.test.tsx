import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const registrySubscribers = new Set<() => void>();
  const storeSubscribers = new Set<() => void>();
  let activeFile: { fileId: string } | null = null;
  let instances: Array<{
    alias: string;
    catalogId: string;
    title?: string;
    enabled: boolean;
    properties: Record<string, unknown>;
  }> = [];
  const setPropertyMock = vi.fn();
  const setDefaultCatalogAliasMock = vi.fn();
  let defaultCatalogAlias = "";
  let hasPanel = true;
  const renderPanelMock = vi.fn((params: { alias: string; catalogId: string }) => (
    <div data-testid={`panel-${params.alias}`}>{params.alias + ":" + params.catalogId}</div>
  ));

  return {
    registrySubscribers,
    storeSubscribers,
    setActiveFile: (value: { fileId: string } | null) => {
      activeFile = value;
    },
    setInstances: (
      value: Array<{
        alias: string;
        catalogId: string;
        title?: string;
        enabled: boolean;
        properties: Record<string, unknown>;
      }>
    ) => {
      instances = value;
    },
    setDefaultCatalogAlias: (value: string) => {
      defaultCatalogAlias = value;
    },
    setHasPanel: (value: boolean) => {
      hasPanel = value;
    },
    getContribution: () =>
      hasPanel
        ? {
            title: "Catalog Title",
            defaultAlias: "jdbc",
            allowMultiple: true,
            renderPanel: renderPanelMock
          }
        : {
            title: "Catalog Title",
            defaultAlias: "jdbc",
            allowMultiple: true
          },
    queryTextRegistry: {
      getActiveFile: () => activeFile,
      subscribe: (listener: () => void) => {
        registrySubscribers.add(listener);
        return {
          dispose: () => {
            registrySubscribers.delete(listener);
          }
        };
      }
    },
    store: {
      subscribe: (listener: () => void) => {
        storeSubscribers.add(listener);
        return () => {
          storeSubscribers.delete(listener);
        };
      },
      listInstances: () => instances,
      setProperty: setPropertyMock,
      setDefaultCatalogAlias: setDefaultCatalogAliasMock,
      buildEngineState: () => ({ payloadbuilder: { defaultCatalogAlias } })
    },
    setPropertyMock,
    setDefaultCatalogAliasMock,
    renderPanelMock,
    reset: () => {
      activeFile = null;
      instances = [];
      setPropertyMock.mockReset();
      setDefaultCatalogAliasMock.mockReset();
      renderPanelMock.mockClear();
      defaultCatalogAlias = "";
      hasPanel = true;
      registrySubscribers.clear();
      storeSubscribers.clear();
    }
  };
});

vi.mock("../core.queryengine/QueryTextEditorRegistry", () => ({
  queryTextRegistry: mocks.queryTextRegistry
}));

vi.mock("./catalog-store", () => ({
  getPayloadbuilderCatalogStore: () => mocks.store
}));

vi.mock("./catalog-contributions", () => ({
  getPayloadbuilderCatalogContribution: () => mocks.getContribution()
}));

vi.mock("../core.settings/service", () => ({
  onCoreSettingsServiceInitialized: () => () => {}
}));

import { PayloadbuilderCatalogSidebar } from "./PayloadbuilderCatalogSidebar";

void React;

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PayloadbuilderCatalogSidebar", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    mocks.reset();
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

  it("renders one panel per enabled alias in provided order", async () => {
    mocks.setActiveFile({ fileId: "file-1" });
    mocks.setInstances([
      { alias: "jdbc2", catalogId: "Jdbc", enabled: true, properties: {} },
      { alias: "jdbc1", catalogId: "Jdbc", enabled: true, properties: {} },
      { alias: "jdbc3", catalogId: "Jdbc", enabled: false, properties: {} }
    ]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar />);
      await flush();
    });

    const titles = Array.from(rootElement.querySelectorAll(".panel-title")).map((el) =>
      el.textContent?.trim()
    );
    expect(titles).toEqual(["jdbc2 - Catalog Title", "jdbc1 - Catalog Title"]);
    expect(rootElement.querySelector('[data-testid="panel-jdbc2"]')).toBeTruthy();
    expect(rootElement.querySelector('[data-testid="panel-jdbc1"]')).toBeTruthy();
    expect(rootElement.querySelector('[data-testid="panel-jdbc3"]')).toBeNull();
  });

  it("binds panel renderer params to the matching alias", async () => {
    mocks.setActiveFile({ fileId: "file-2" });
    mocks.setInstances([
      {
        alias: "analytics",
        catalogId: "Jdbc",
        title: "Analytics",
        enabled: true,
        properties: { database: "reporting" }
      }
    ]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar />);
      await flush();
    });

    expect(mocks.renderPanelMock).toHaveBeenCalledTimes(1);
    const params = mocks.renderPanelMock.mock.calls[0]?.[0] as {
      fileId: string;
      alias: string;
      catalogId: string;
      properties: Record<string, unknown>;
      setProperty: (propertyKey: string, value: unknown) => void;
    };
    expect(params.fileId).toBe("file-2");
    expect(params.alias).toBe("analytics");
    expect(params.catalogId).toBe("Jdbc");
    expect(params.properties).toEqual({ database: "reporting" });

    params.setProperty("database", "warehouse");
    expect(mocks.setPropertyMock).toHaveBeenCalledWith(
      "file-2",
      "analytics",
      "database",
      "warehouse"
    );
  });

  it("sets selected alias as default catalog", async () => {
    mocks.setActiveFile({ fileId: "file-2" });
    mocks.setInstances([
      { alias: "a", catalogId: "Jdbc", enabled: true, properties: {} },
      { alias: "b", catalogId: "Jdbc", enabled: true, properties: {} }
    ]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar />);
      await flush();
    });

    const radios = Array.from(rootElement.querySelectorAll('input[type="radio"]'));
    expect(radios).toHaveLength(2);

    await act(async () => {
      radios[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
    });

    expect(mocks.setDefaultCatalogAliasMock).toHaveBeenCalledWith("file-2", "b");
  });

  it("hides aliases without panel contribution", async () => {
    mocks.setHasPanel(false);
    mocks.setActiveFile({ fileId: "file-3" });
    mocks.setInstances([{ alias: "fs", catalogId: "filesystem", enabled: true, properties: {} }]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar />);
      await flush();
    });

    expect(rootElement.textContent).toContain("No configurable catalog panels for this file.");
    expect(rootElement.querySelector(".panel-card")).toBeNull();
  });
});
