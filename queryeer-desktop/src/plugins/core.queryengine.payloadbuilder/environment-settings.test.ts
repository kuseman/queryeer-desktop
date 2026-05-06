import { describe, expect, it } from "vitest";
import { parsePayloadbuilderEnvironments } from "./environment-settings";

describe("payloadbuilder environment settings", () => {
  it("keeps vault-backed secret refs and ignores plaintext secretRef values", () => {
    const parsed = parsePayloadbuilderEnvironments([
      {
        id: "prod",
        title: "Production",
        variables: [
          { key: "apiKey", secretRef: { secretRef: "secret-ref-1" } },
          { key: "legacy", secretRef: "plaintext-secret" },
          { key: "tenant", value: "acme" }
        ]
      }
    ]);

    expect(parsed).toEqual([
      {
        id: "prod",
        title: "Production",
        variables: [
          { key: "apiKey", secretRef: { secretRef: "secret-ref-1" } },
          { key: "tenant", value: "acme" }
        ]
      }
    ]);
  });
});
