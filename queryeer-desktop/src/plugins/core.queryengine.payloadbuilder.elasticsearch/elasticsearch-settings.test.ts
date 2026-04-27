import { describe, expect, it } from "vitest";
import { parseElasticsearchConnectionDefinitions } from "./elasticsearch-settings";

describe("elasticsearch settings", () => {
  it("parses valid connection entries", () => {
    const parsed = parseElasticsearchConnectionDefinitions([
      {
        connectionId: "cluster1",
        endpoint: "https://localhost:9200"
      },
      {
        connectionId: "cluster2",
        endpoint: "https://es.internal",
        authType: "BASIC",
        authUsername: "elastic",
        authPassword: {
          secretRef: "secret-ref"
        },
        enabled: false
      }
    ]);

    expect(parsed).toEqual([
      {
        connectionId: "cluster1",
        title: undefined,
        endpoint: "https://localhost:9200",
        authType: "NONE",
        authUsername: undefined,
        authPassword: undefined,
        enabled: true
      },
      {
        connectionId: "cluster2",
        title: undefined,
        endpoint: "https://es.internal",
        authType: "BASIC",
        authUsername: "elastic",
        authPassword: {
          secretRef: "secret-ref"
        },
        enabled: false
      }
    ]);
  });

  it("filters invalid and duplicate entries", () => {
    const parsed = parseElasticsearchConnectionDefinitions([
      { connectionId: "", endpoint: "https://localhost:9200" },
      { connectionId: "cluster1", endpoint: "" },
      { connectionId: "cluster1", endpoint: "https://a" },
      { connectionId: "cluster1", endpoint: "https://b" },
      "bad"
    ]);

    expect(parsed).toEqual([
      {
        connectionId: "cluster1",
        title: undefined,
        endpoint: "https://a",
        authType: "NONE",
        authUsername: undefined,
        authPassword: undefined,
        enabled: true
      }
    ]);
  });
});
