import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const editorListeners = new Set<(editor: { fileId: string | null } | null) => void>();
  let activeFileId: string | null = null;
  let instances: Array<{
    alias: string;
    catalogId: string;
    title?: string;
    enabled: boolean;
    properties: Record<string, unknown>;
  }> = [];
  const setPropertyMock = vi.fn();
  const setDefaultCatalogAliasMock = vi.fn();
  const openModalForSettingMock = vi.fn();
  let defaultCatalogAlias = "";
  let hasPanel = true;
  let environments: Array<{ id: string; title: string }> = [];
  const renderPanelMock = vi.fn((params: { alias: string; catalogId: string }) => (
    <div data-testid={`panel-${params.alias}`}>{params.alias + ":" + params.catalogId}</div>
  ));

  return {
    editorListeners,
    setActiveFileId: (value: string | null) => {
      activeFileId = value;
      for (const listener of editorListeners) {
        listener(value ? { fileId: value } : null);
      }
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
    setEnvironments: (value: Array<{ id: string; title: string }>) => {
      environments = value;
    },
    getEnvironments: () => environments,
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
    editorRegistryHost: {
      getActiveEditor: () => (activeFileId ? { editorId: "test", fileId: activeFileId } : null),
      onActiveEditorChanged: () => {
        return {
          dispose: () => {}
        };
      },
      setActiveEditor: () => {},
      registerContentRepository: () => () => {},
      resolveFileContent: () => undefined,
      broadcastContentUpdate: () => {},
      applyRecoveredContent: () => {},
      onContentDirty: () => () => {}
    },
    store: {
      subscribe: () => {
        return () => {};
      },
      listInstances: () => instances,
      setProperty: setPropertyMock,
      setDefaultCatalogAlias: setDefaultCatalogAliasMock,
      setSelectedEnvironmentId: vi.fn(),
      buildEngineState: () => ({ payloadbuilder: { defaultCatalogAlias } })
    },
    setPropertyMock,
    setDefaultCatalogAliasMock,
    renderPanelMock,
    openModalForSettingMock,
    reset: () => {
      activeFileId = null;
      instances = [];
      setPropertyMock.mockReset();
      setDefaultCatalogAliasMock.mockReset();
      openModalForSettingMock.mockReset();
      renderPanelMock.mockClear();
      defaultCatalogAlias = "";
      environments = [];
      hasPanel = true;
      editorListeners.clear();
    }
  };
});

vi.mock("../../core/plugin-runtime/ExtensionRegistry", () => ({
  getEditorRegistryHost: () => mocks.editorRegistryHost
}));

vi.mock("./catalog-store", () => ({
  getPayloadbuilderCatalogStore: () => mocks.store
}));

vi.mock("./catalog-contributions", () => ({
  getPayloadbuilderCatalogContribution: () => mocks.getContribution()
}));

vi.mock("./environment-settings", () => ({
  PAYLOADBUILDER_ENVIRONMENTS_SETTING_ID: "core.queryengine.payloadbuilder.environments.values",
  getPayloadbuilderEnvironments: () => mocks.getEnvironments()
}));

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: () => ({
    openModalForSetting: mocks.openModalForSettingMock
  }),
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
    mocks.setActiveFileId("file-1");
    mocks.setInstances([
      { alias: "jdbc2", catalogId: "Jdbc", enabled: true, properties: {} },
      { alias: "jdbc1", catalogId: "Jdbc", enabled: true, properties: {} },
      { alias: "jdbc3", catalogId: "Jdbc", enabled: false, properties: {} }
    ]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar editorRegistryHost={mocks.editorRegistryHost} />);
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
    mocks.setActiveFileId("file-2");
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
      root.render(<PayloadbuilderCatalogSidebar editorRegistryHost={mocks.editorRegistryHost} />);
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
    mocks.setActiveFileId("file-2");
    mocks.setInstances([
      { alias: "a", catalogId: "Jdbc", enabled: true, properties: {} },
      { alias: "b", catalogId: "Jdbc", enabled: true, properties: {} }
    ]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar editorRegistryHost={mocks.editorRegistryHost} />);
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
    mocks.setActiveFileId("file-3");
    mocks.setInstances([{ alias: "fs", catalogId: "filesystem", enabled: true, properties: {} }]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar editorRegistryHost={mocks.editorRegistryHost} />);
      await flush();
    });

    expect(rootElement.textContent).toContain("No configurable catalog panels for this file.");
    expect(rootElement.querySelector(".panel-card")).toBeNull();
  });

  it("renders environment selector and persists selected environment", async () => {
    mocks.setActiveFileId("file-4");
    mocks.setEnvironments([
      { id: "test", title: "Test" },
      { id: "prod", title: "Production" }
    ]);

    await act(async () => {
      root.render(<PayloadbuilderCatalogSidebar editorRegistryHost={mocks.editorRegistryHost} />);
      await flush();
    });

    const select = rootElement.querySelector("select.payloadbuilder-catalog-select") as HTMLSelectElement;
    expect(select).toBeTruthy();

    await act(async () => {
      select.value = "prod";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await flush();
    });

    expect((mocks.store.setSelectedEnvironmentId as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "file-4",
      "prod"
    );

    const settingsButton = rootElement.querySelector(
      'button[aria-label="Open environment settings"]'
    ) as HTMLButtonElement;
    expect(settingsButton).toBeTruthy();
    await act(async () => {
      settingsButton.click();
      await flush();
    });
    expect(mocks.openModalForSettingMock).toHaveBeenCalledWith(
      "core.queryengine.payloadbuilder.environments.values"
    );
  });
});
