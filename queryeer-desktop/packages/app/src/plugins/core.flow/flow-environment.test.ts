import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLOW_ENVIRONMENT_CONFIG,
  getFlowLocalMapping,
  listFlowEnvironmentNames,
  parseFlowEnvironmentConfig,
  withActiveFlowEnvironment,
  withFlowLocalMapping,
  withoutFlowLocalMapping
} from "./flow-environment";

describe("flow environment", () => {
  it("parses active and explicit environment names", () => {
    expect(parseFlowEnvironmentConfig({
      activeEnvironment: "test",
      environments: ["prod", "dev"],
      mappings: [
        {
          environment: "dev",
          owner: "core.queryengine.payloadbuilder",
          kind: "elasticsearch.connection",
          ref: "search-prod",
          value: "uuid-1"
        }
      ]
    })).toEqual({
      activeEnvironment: "test",
      environments: ["dev", "prod"],
      mappings: [
        {
          environment: "dev",
          owner: "core.queryengine.payloadbuilder",
          kind: "elasticsearch.connection",
          ref: "search-prod",
          value: "uuid-1"
        }
      ]
    });
  });

  it("falls back to default config for invalid settings", () => {
    expect(parseFlowEnvironmentConfig(null)).toEqual(DEFAULT_FLOW_ENVIRONMENT_CONFIG);
    expect(parseFlowEnvironmentConfig({ activeEnvironment: "", environments: "bad" })).toEqual(
      DEFAULT_FLOW_ENVIRONMENT_CONFIG
    );
  });

  it("lists active and configured environment names", () => {
    expect(listFlowEnvironmentNames({
      activeEnvironment: "dev",
      environments: ["test", "prod"],
      mappings: []
    })).toEqual(["dev", "prod", "test"]);
  });

  it("updates active environment with default fallback", () => {
    expect(withActiveFlowEnvironment(DEFAULT_FLOW_ENVIRONMENT_CONFIG, "prod")).toEqual({
      activeEnvironment: "prod",
      environments: ["dev", "prod"],
      mappings: []
    });
    expect(withActiveFlowEnvironment(DEFAULT_FLOW_ENVIRONMENT_CONFIG, " ")).toEqual(DEFAULT_FLOW_ENVIRONMENT_CONFIG);
  });

  it("upserts, resolves, and removes local mappings", () => {
    const mapping = {
      environment: "dev",
      owner: "core.queryengine.payloadbuilder",
      kind: "elasticsearch.connection",
      ref: "someConnection",
      value: "uuid-1"
    };
    const config = withFlowLocalMapping(DEFAULT_FLOW_ENVIRONMENT_CONFIG, mapping);

    expect(getFlowLocalMapping(config, {
      environment: "dev",
      owner: "core.queryengine.payloadbuilder",
      kind: "elasticsearch.connection",
      ref: "someConnection"
    })).toEqual(mapping);

    expect(withoutFlowLocalMapping(config, {
      environment: "dev",
      owner: "core.queryengine.payloadbuilder",
      kind: "elasticsearch.connection",
      ref: "someConnection"
    }).mappings).toEqual([]);
  });
});
