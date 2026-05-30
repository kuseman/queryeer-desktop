import { describe, expect, it } from "vitest";
import {
  OPENAI_DEFAULT_HOST,
  createAssistantConnection,
  sanitizeAssistantConnections
} from "./assistant-types";

describe("assistant-types", () => {
  it("creates editable OpenAI-compatible connections with the OpenAI host prefilled", () => {
    const connection = createAssistantConnection("openai");

    expect(connection.provider).toBe("openai");
    expect(connection.apiType).toBe("openai");
    expect(connection.host).toBe(OPENAI_DEFAULT_HOST);
  });

  it("sanitizes configured connections while preserving edited hosts and secret refs", () => {
    const connections = sanitizeAssistantConnections([
      {
        id: "openai-1",
        provider: "openai",
        apiType: "openai",
        name: "OpenAI Proxy",
        host: "https://proxy.example/v1",
        apiKeyRef: { secretRef: "secret-1" },
        apiKey: "must-not-survive"
      }
    ]);

    expect(connections).toEqual([
      {
        id: "openai-1",
        provider: "openai",
        apiType: "openai",
        name: "OpenAI Proxy",
        host: "https://proxy.example/v1",
        apiKeyRef: { secretRef: "secret-1" }
      }
    ]);
    expect(connections[0]).not.toHaveProperty("apiKey");
  });

  it("allows custom providers without API key refs", () => {
    const connections = sanitizeAssistantConnections([
      {
        id: "local",
        provider: "custom",
        apiType: "openai",
        name: "LM Studio",
        host: "http://localhost:1234/v1"
      }
    ]);

    expect(connections[0]?.provider).toBe("custom");
    expect(connections[0]?.apiKeyRef).toBeUndefined();
  });
});
