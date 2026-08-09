import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const configuredConnectionsMock = vi.hoisted(() => vi.fn());

vi.mock("./mongodb-settings", () => ({
  getConfiguredMongoConnections: configuredConnectionsMock
}));

import { getPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderMongoCatalogContribution } from "./mongodb-catalog-contribution";

describe("payloadbuilder mongodb catalog contribution", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    configuredConnectionsMock.mockReset();
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "mongo-1",
        title: "Production",
        connectionString: "mongodb://localhost:27017",
        enabled: true
      }
    ]);
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rootElement.remove();
    vi.unstubAllGlobals();
  });

  it("registers without flow fields and persists only the connection id", () => {
    registerPayloadbuilderMongoCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("mongodb");

    expect(contribution).toMatchObject({
      title: "MongoDB",
      defaultAlias: "mongo",
      allowMultiple: true
    });
    expect(contribution?.flowMappingFields).toBeUndefined();
    expect(contribution?.filterPersistedProperties?.({
      connectionId: "mongo-1",
      connectionString: "mongodb://should-not-persist",
      authPassword: "should-not-persist"
    })).toEqual({ connectionId: "mongo-1" });
  });

  it("selects the first enabled connection when unconfigured", async () => {
    registerPayloadbuilderMongoCatalogContribution();
    const renderPanel = getPayloadbuilderCatalogContribution("mongodb")?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected MongoDB catalog panel");
    }
    const setProperty = vi.fn();

    await act(async () => {
      root.render(renderPanel({
        fileId: "file-1",
        alias: "mongo",
        catalogId: "mongodb",
        properties: {},
        setProperty
      }) as React.ReactElement);
    });

    expect(setProperty).toHaveBeenCalledWith("connectionId", "mongo-1");
    expect(rootElement.querySelector("select")?.value).toBe("mongo-1");
  });

  it("does not resolve disabled connections", () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "mongo-disabled",
        connectionString: "mongodb://localhost:27017",
        enabled: false
      }
    ]);
    registerPayloadbuilderMongoCatalogContribution();

    expect(getPayloadbuilderCatalogContribution("mongodb")?.resolveRuntimeProperties?.({
      connectionId: "mongo-disabled"
    })).toEqual({});
  });
});
