import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({
    invoke: invokeMock
  })
}));

vi.mock("./kafka-settings", () => ({
  getConfiguredKafkaConnections: () => [
    {
      connectionId: "550e8400-e29b-41d4-a716-446655440300",
      title: "Broker One",
      bootstrapServers: "localhost:9092",
      securityProtocol: "PLAINTEXT",
      enabled: true
    }
  ]
}));

import { getPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderKafkaCatalogContribution } from "./kafka-catalog-contribution";

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("payloadbuilder kafka catalog contribution", () => {
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

  it("registers kafka panel and loads topics via invoke", async () => {
    registerPayloadbuilderKafkaCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("kafka");
    expect(contribution).toBeDefined();
    expect(await contribution?.flowMappingFields?.[0]?.listOptions?.({})).toEqual([{
      value: "550e8400-e29b-41d4-a716-446655440300",
      label: "Broker One"
    }]);
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected kafka contribution renderPanel");
    }

    invokeMock.mockResolvedValue({ topics: ["orders", "shipments"] });

    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "kfk1",
          catalogId: "kafka",
          properties: {
            connectionId: "550e8400-e29b-41d4-a716-446655440300"
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
      action: "payloadbuilder.kafka.listTopics",
      payload: {
        alias: "kfk1",
        properties: {
          connectionId: "550e8400-e29b-41d4-a716-446655440300"
        }
      }
    });

    const topicSelect = rootElement.querySelector("#payloadbuilder-kafka-topic-kfk1") as HTMLSelectElement | null;
    expect(topicSelect).not.toBeNull();
    const optionValues = Array.from(topicSelect?.querySelectorAll("option") ?? []).map((option) => option.getAttribute("value"));
    expect(optionValues).toEqual(["", "orders", "shipments"]);
    expect(setPropertyMock).toHaveBeenCalledWith("topic", "orders");
  });

  it("persists default connectionId when missing", async () => {
    registerPayloadbuilderKafkaCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("kafka");
    expect(contribution).toBeDefined();
    const renderPanel = contribution?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected kafka contribution renderPanel");
    }

    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(
        renderPanel({
          fileId: "file-1",
          alias: "kfk1",
          catalogId: "kafka",
          properties: {},
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(setPropertyMock).toHaveBeenCalledWith("connectionId", "550e8400-e29b-41d4-a716-446655440300");
  });
});
