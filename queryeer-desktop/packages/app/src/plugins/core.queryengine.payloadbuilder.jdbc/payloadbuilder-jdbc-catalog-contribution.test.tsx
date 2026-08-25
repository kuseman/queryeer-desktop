import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadMock = vi.fn();
const configuredConnectionsMock = vi.hoisted(() => vi.fn(() => [
  {
    connectionId: "conn-a",
    title: "Reports",
    dialectId: "jdbc",
    url: "jdbc:postgresql://localhost/reports",
    enabled: true
  }
]));

vi.mock("../core.queryengine.jdbc/jdbc-settings", () => ({
  getConfiguredJdbcConnections: configuredConnectionsMock
}));

vi.mock("../core.queryengine.jdbc/jdbc-database-cache", () => ({
  getJdbcDatabaseCache: () => ({
    load: loadMock
  })
}));

import { getPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderJdbcCatalogContribution } from "./payloadbuilder-jdbc-catalog-contribution";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("payloadbuilder jdbc catalog contribution", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    loadMock.mockReset();
    configuredConnectionsMock.mockReset();
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "conn-a",
        title: "Reports",
        dialectId: "jdbc",
        url: "jdbc:postgresql://localhost/reports",
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

  it("loads databases for selected jdbc connection", async () => {
    registerPayloadbuilderJdbcCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("jdbc");
    expect(contribution).toBeDefined();
    expect(await contribution?.flowMappingFields?.[0]?.listOptions?.({})).toEqual([{
      value: "conn-a",
      label: "Reports"
    }]);
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected jdbc contribution renderPanel");
    }

    loadMock.mockResolvedValue(["reporting", "sales"]);
    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "jdbc1",
          catalogId: "jdbc",
          properties: { connectionId: "conn-a" },
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(loadMock).toHaveBeenCalledWith("conn-a");
    const dbSelect = rootElement.querySelector("#payloadbuilder-jdbc-database-jdbc1") as HTMLSelectElement;
    const options = Array.from(dbSelect.querySelectorAll("option")).map((option) => option.value);
    expect(options).toEqual(["", "reporting", "sales"]);
  });

  it("persists default connectionId when missing", async () => {
    registerPayloadbuilderJdbcCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("jdbc");
    expect(contribution).toBeDefined();
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected jdbc contribution renderPanel");
    }

    loadMock.mockResolvedValue([]);
    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "jdbc1",
          catalogId: "jdbc",
          properties: {},
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(setPropertyMock).toHaveBeenCalledWith("connectionId", "conn-a");
  });

  it("preserves selections when the persisted connection is temporarily unavailable", async () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "conn-a",
        title: "Reports",
        dialectId: "jdbc",
        url: "jdbc:postgresql://localhost/reports",
        enabled: true
      },
      {
        connectionId: "conn-disabled",
        title: "Disabled",
        dialectId: "jdbc",
        url: "jdbc:postgresql://localhost/disabled",
        enabled: false
      }
    ]);
    registerPayloadbuilderJdbcCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("jdbc");
    expect(contribution).toBeDefined();
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected jdbc contribution renderPanel");
    }

    loadMock.mockResolvedValue(["reporting"]);
    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "jdbc1",
          catalogId: "jdbc",
          properties: { connectionId: "conn-disabled", database: "old-db" },
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(setPropertyMock).not.toHaveBeenCalledWith("connectionId", "");
    expect(setPropertyMock).not.toHaveBeenCalledWith("database", "");
    expect(setPropertyMock).not.toHaveBeenCalledWith("connectionId", "conn-a");

    const connectionSelect = rootElement.querySelector("#payloadbuilder-jdbc-connection-jdbc1") as HTMLSelectElement;
    const dbSelect = rootElement.querySelector("#payloadbuilder-jdbc-database-jdbc1") as HTMLSelectElement;
    const options = Array.from(dbSelect.querySelectorAll("option")).map((option) => option.value);
    expect(connectionSelect.value).toBe("conn-disabled");
    expect(dbSelect.value).toBe("old-db");
    expect(options).toContain("old-db");
  });

  it("does not auto-select first connection after connection was explicitly cleared", async () => {
    registerPayloadbuilderJdbcCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("jdbc");
    expect(contribution).toBeDefined();
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected jdbc contribution renderPanel");
    }

    loadMock.mockResolvedValue(["reporting"]);
    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "jdbc1",
          catalogId: "jdbc",
          properties: { connectionId: "", database: "" },
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(setPropertyMock).not.toHaveBeenCalledWith("connectionId", "conn-a");
    const connectionSelect = rootElement.querySelector("#payloadbuilder-jdbc-connection-jdbc1") as HTMLSelectElement;
    expect(connectionSelect.value).toBe("");
  });

  it("does not resolve disabled jdbc connection into runtime properties", () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "conn-disabled",
        title: "Disabled",
        dialectId: "jdbc",
        url: "jdbc:postgresql://localhost/disabled",
        enabled: false
      }
    ]);
    registerPayloadbuilderJdbcCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("jdbc");

    expect(contribution?.resolveRuntimeProperties?.({
      connectionId: "conn-disabled",
      database: "old-db"
    })).toEqual({});
  });
});
