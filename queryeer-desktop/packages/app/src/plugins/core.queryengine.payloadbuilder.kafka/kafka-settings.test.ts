import { describe, expect, it } from "vitest";
import { parseKafkaConnectionDefinitions } from "./kafka-settings";

describe("kafka settings", () => {
  it("parses valid connection entries", () => {
    const parsed = parseKafkaConnectionDefinitions([
      {
        connectionId: "broker1",
        bootstrapServers: "localhost:9092"
      },
      {
        connectionId: "broker2",
        title: "Staging",
        bootstrapServers: "broker1:9092,broker2:9092",
        schemaRegistryUrl: "https://schema:8081",
        securityProtocol: "SASL_SSL",
        saslMechanism: "SCRAM-SHA-512",
        saslJaasConfig: {
          secretRef: "kafka-jaas-secret"
        },
        enabled: false
      }
    ]);

    expect(parsed).toEqual([
      {
        connectionId: "broker1",
        title: undefined,
        bootstrapServers: "localhost:9092",
        schemaRegistryUrl: undefined,
        securityProtocol: "PLAINTEXT",
        saslMechanism: undefined,
        saslJaasConfig: undefined,
        enabled: true
      },
      {
        connectionId: "broker2",
        title: "Staging",
        bootstrapServers: "broker1:9092,broker2:9092",
        schemaRegistryUrl: "https://schema:8081",
        securityProtocol: "SASL_SSL",
        saslMechanism: "SCRAM-SHA-512",
        saslJaasConfig: {
          secretRef: "kafka-jaas-secret"
        },
        enabled: false
      }
    ]);
  });

  it("filters invalid and duplicate entries", () => {
    const parsed = parseKafkaConnectionDefinitions([
      { connectionId: "", bootstrapServers: "localhost:9092" },
      { connectionId: "broker1", bootstrapServers: "" },
      { connectionId: "broker1", bootstrapServers: "broker1:9092" },
      { connectionId: "broker1", bootstrapServers: "broker2:9092" },
      "bad"
    ]);

    expect(parsed).toEqual([
      {
        connectionId: "broker1",
        title: undefined,
        bootstrapServers: "broker1:9092",
        schemaRegistryUrl: undefined,
        securityProtocol: "PLAINTEXT",
        saslMechanism: undefined,
        saslJaasConfig: undefined,
        enabled: true
      }
    ]);
  });

  it("drops unknown security protocol and sasl mechanism to defaults", () => {
    const parsed = parseKafkaConnectionDefinitions([
      {
        connectionId: "broker1",
        bootstrapServers: "localhost:9092",
        securityProtocol: "WIBBLE",
        saslMechanism: "GIBBERISH"
      }
    ]);

    expect(parsed).toEqual([
      {
        connectionId: "broker1",
        title: undefined,
        bootstrapServers: "localhost:9092",
        schemaRegistryUrl: undefined,
        securityProtocol: "PLAINTEXT",
        saslMechanism: undefined,
        saslJaasConfig: undefined,
        enabled: true
      }
    ]);
  });
});
