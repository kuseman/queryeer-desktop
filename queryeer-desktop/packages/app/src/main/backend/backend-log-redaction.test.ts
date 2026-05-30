import { describe, expect, it } from "vitest";
import { redactErrorMessage, redactLogMessage } from "./backend-log-redaction.js";

describe("backend-log-redaction", () => {
  it("redacts sensitive key=value pairs in plain text", () => {
    const message = "connectionString=jdbc://user:pass@host token=abc123 password=secret";
    const redacted = redactLogMessage(message);

    expect(redacted).toContain("connectionString=[REDACTED]");
    expect(redacted).toContain("token=[REDACTED]");
    expect(redacted).toContain("password=[REDACTED]");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("secret");
  });

  it("redacts sensitive fields in JSON payloads", () => {
    const message = JSON.stringify({
      auth: {
        apiKey: "k1",
        clientSecret: "k2"
      },
      nested: {
        passwordValue: "k3"
      },
      safe: "ok"
    });

    const redacted = redactLogMessage(message);
    expect(redacted).toContain('"apiKey":"[REDACTED]"');
    expect(redacted).toContain('"clientSecret":"[REDACTED]"');
    expect(redacted).toContain('"passwordValue":"[REDACTED]"');
    expect(redacted).toContain('"safe":"ok"');
    expect(redacted).not.toContain("k1");
    expect(redacted).not.toContain("k2");
    expect(redacted).not.toContain("k3");
  });

  it("redacts sessionKeyBase64 in security session open envelope", () => {
    const message = JSON.stringify({
      method: "security.session.open",
      params: {
        sessionId: "some-uuid",
        vaultPath: "/some/path/vault.json",
        sessionKeyBase64: "abc123secretkey=="
      }
    });

    const redacted = redactLogMessage(message);
    expect(redacted).toContain('"sessionKeyBase64":"[REDACTED]"');
    expect(redacted).not.toContain("abc123secretkey==");
  });

  it("redacts error messages", () => {
    const error = new Error("authorization: bearer-secret");
    const redacted = redactErrorMessage(error);
    expect(redacted).toContain("authorization: [REDACTED]");
    expect(redacted).not.toContain("bearer-secret");
  });
});
