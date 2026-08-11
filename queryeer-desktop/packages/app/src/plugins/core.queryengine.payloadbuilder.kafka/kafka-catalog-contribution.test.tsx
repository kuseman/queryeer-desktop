import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const configuredConnectionsMock = vi.hoisted(() => vi.fn(() => [
  {
    connectionId: "550e8400-e29b-41d4-a716-446655440300",
    title: "Broker One",
    bootstrapServers: "localhost:9092",
    securityProtocol: "PLAINTEXT",
    enabled: true
  }
]));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({
    invoke: invokeMock
  })
}));

vi.mock("./kafka-settings", () => ({
  getConfiguredKafkaConnections: configuredConnectionsMock
}));

import { getPayloadbuilderCatalogContribution } from "../core.queryengine.payloadbuilder/catalog-contributions";
import { registerPayloadbuilderKafkaCatalogContribution } from "./kafka-catalog-contribution";

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

describe("payloadbuilder kafka catalog contribution", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("React", React);
    invokeMock.mockReset();
    configuredConnectionsMock.mockReset();
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "550e8400-e29b-41d4-a716-446655440300",
        title: "Broker One",
        bootstrapServers: "localhost:9092",
        securityProtocol: "PLAINTEXT",
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

  it("ignores an out-of-order reload after switching connection, file, and alias", async () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "broker-a",
        title: "Broker A",
        bootstrapServers: "a:9092",
        securityProtocol: "PLAINTEXT",
        enabled: true
      },
      {
        connectionId: "broker-b",
        title: "Broker B",
        bootstrapServers: "b:9092",
        securityProtocol: "PLAINTEXT",
        enabled: true
      }
    ]);
    registerPayloadbuilderKafkaCatalogContribution();
    const renderPanel = getPayloadbuilderCatalogContribution("kafka")?.renderPanel;
    if (!renderPanel) {
      throw new Error("Expected kafka contribution renderPanel");
    }

    const responseA = deferred<{ topics: string[] }>();
    const responseB = deferred<{ topics: string[] }>();
    invokeMock.mockReturnValueOnce(responseA.promise).mockReturnValueOnce(responseB.promise);
    const setPropertyMock = vi.fn();

    await act(async () => {
      root.render(renderPanel({
        fileId: "file-a",
        alias: "kafka-a",
        catalogId: "kafka",
        properties: { connectionId: "broker-a" },
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
        alias: "kafka-b",
        catalogId: "kafka",
        properties: { connectionId: "broker-b" },
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
      responseB.resolve({ topics: ["b-topic"] });
      await flush();
      responseA.resolve({ topics: ["a-topic"] });
      await flush();
    });

    expect(invokeMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      fileId: "file-b",
      payload: expect.objectContaining({
        alias: "kafka-b",
        properties: { connectionId: "broker-b" }
      })
    }));
    const topicSelect = rootElement.querySelector("#payloadbuilder-kafka-topic-kafka-b") as HTMLSelectElement;
    expect(Array.from(topicSelect.options).map((option) => option.value)).toEqual(["", "b-topic"]);
    expect(setPropertyMock).toHaveBeenCalledWith("topic", "b-topic");
    expect(setPropertyMock).not.toHaveBeenCalledWith("topic", "a-topic");
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

  it("clears stale topic when persisted connection is disabled", async () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "550e8400-e29b-41d4-a716-446655440300",
        title: "Broker One",
        bootstrapServers: "localhost:9092",
        securityProtocol: "PLAINTEXT",
        enabled: true
      },
      {
        connectionId: "broker-disabled",
        title: "Disabled",
        bootstrapServers: "disabled:9092",
        securityProtocol: "PLAINTEXT",
        enabled: false
      }
    ]);
    registerPayloadbuilderKafkaCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("kafka");
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
          properties: { connectionId: "broker-disabled", topic: "old-topic" },
          setProperty: setPropertyMock
        }) as React.ReactElement
      );
      await flush();
    });

    expect(setPropertyMock).toHaveBeenCalledWith("connectionId", "");
    expect(setPropertyMock).toHaveBeenCalledWith("topic", "");
    expect(setPropertyMock).not.toHaveBeenCalledWith("connectionId", "550e8400-e29b-41d4-a716-446655440300");
    const topicSelect = rootElement.querySelector("#payloadbuilder-kafka-topic-kfk1") as HTMLSelectElement;
    const options = Array.from(topicSelect.querySelectorAll("option")).map((option) => option.value);
    expect(topicSelect.value).toBe("");
    expect(options).not.toContain("old-topic");
  });

  it("does not resolve disabled kafka connection into runtime properties", () => {
    configuredConnectionsMock.mockReturnValue([
      {
        connectionId: "broker-disabled",
        title: "Disabled",
        bootstrapServers: "disabled:9092",
        securityProtocol: "PLAINTEXT",
        enabled: false
      }
    ]);
    registerPayloadbuilderKafkaCatalogContribution();
    const contribution = getPayloadbuilderCatalogContribution("kafka");

    expect(contribution?.resolveRuntimeProperties?.({
      connectionId: "broker-disabled",
      topic: "old-topic"
    })).toEqual({});
  });
});
