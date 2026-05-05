import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { describe, it, expect } from "vitest";

const BACKEND_PROTOCOL_VERSION = "1.0.0";
const FIXTURE_DIR = join(process.cwd(), "..", "protocol-fixtures", "backend");

const readFixture = (name: string) => {
  const file = join(FIXTURE_DIR, name);
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
};

const assertEnvelopeBase = (envelope: Record<string, unknown>) => {
  expect(envelope.protocolVersion).toBe(BACKEND_PROTOCOL_VERSION);
  expect(["request", "response", "notification"]).toContain(envelope.type);
};

describe("Protocol fixture compatibility", () => {
  it("handshake fixtures", () => {
    const request = readFixture("request-handshake.json");
    const response = readFixture("response-handshake.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.type).toBe("request");
    expect(response.type).toBe("response");
    expect(request.method).toBe("backend.handshake");
    expect(request.id).toBe(response.id);
  });

  it("ping fixtures", () => {
    const request = readFixture("request-ping.json");
    const response = readFixture("response-ping.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.method).toBe("health.ping");
    expect(request.id).toBe(response.id);
  });

  it("runtime status fixtures", () => {
    const request = readFixture("request-runtime-status.json");
    const response = readFixture("response-runtime-status.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.method).toBe("backend.runtimeStatus");
    expect(request.id).toBe(response.id);
    expect(Array.isArray((response.result as Record<string, unknown>)?.pluginStatuses)).toBe(true);
  });

  it("query execute fixtures", () => {
    const request = readFixture("request-query-execute.json");
    const response = readFixture("response-query-execute.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.method).toBe("queryengine.execute");
    expect(request.id).toBe(response.id);

    const params = request.params as Record<string, unknown>;
    const result = response.result as Record<string, unknown>;
    expect(params.queryExecutionId).toBe(result.queryExecutionId);
    expect(typeof params.fileId).toBe("string");
    expect(typeof params.engineId).toBe("string");
    expect(typeof params.text).toBe("string");
    expect(params.engineState).toBeDefined();
    expect(params.parameters).toBeUndefined();
  });

  it("query cancel fixtures", () => {
    const request = readFixture("request-query-cancel.json");
    const response = readFixture("response-query-cancel.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.method).toBe("queryengine.cancel");
    expect(request.id).toBe(response.id);
    const params = request.params as Record<string, unknown>;
    const result = response.result as Record<string, unknown>;
    expect(params.queryExecutionId).toBe(result.queryExecutionId);
  });

  it("connection upsert fixtures", () => {
    const request = readFixture("request-connection-upsert.json");
    const response = readFixture("response-connection-upsert.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.method).toBe("connection.upsert");
    expect(request.id).toBe(response.id);
    const result = response.result as Record<string, unknown>;
    expect(typeof result.connectionId).toBe("string");
  });

  it("file open fixtures", () => {
    const request = readFixture("request-file-open.json");
    const response = readFixture("response-file-open.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.method).toBe("file.open");
    expect(request.id).toBe(response.id);
    const params = request.params as Record<string, unknown>;
    const result = response.result as Record<string, unknown>;
    expect(typeof params.fileId).toBe("string");
    expect(typeof params.uri).toBe("string");
    expect(typeof params.mimeType).toBe("string");
    expect(params.fileId).toBe(result.fileId);
    expect(typeof result.backendVersion).toBe("number");
  });

  it("file close fixtures", () => {
    const request = readFixture("request-file-close.json");
    const response = readFixture("response-file-close.json");
    assertEnvelopeBase(request);
    assertEnvelopeBase(response);
    expect(request.method).toBe("file.close");
    expect(request.id).toBe(response.id);
    const params = request.params as Record<string, unknown>;
    const result = response.result as Record<string, unknown>;
    expect(params.fileId).toBe(result.fileId);
    expect(result.accepted).toBe(true);
  });

  it("JDBC engineState fixture", () => {
    const request = readFixture("request-query-execute-jdbc.json");
    assertEnvelopeBase(request);
    expect(request.method).toBe("queryengine.execute");
    const engineState = (request.params as Record<string, unknown>).engineState as Record<string, unknown>;
    expect(engineState?.connectionId).toBe("550e8400-e29b-41d4-a716-446655440010");
    expect(engineState?.database).toBe("appdb");
  });

  it("Payloadbuilder engineState fixture", () => {
    const request = readFixture("request-query-execute-payloadbuilder.json");
    assertEnvelopeBase(request);
    expect(request.method).toBe("queryengine.execute");
    const engineState = (request.params as Record<string, unknown>).engineState as Record<string, unknown>;
    expect(engineState?.defaultAlias).toBe("es1");
    const catalogs = engineState?.catalogs as Record<string, Record<string, unknown>>;
    expect(catalogs?.es1?.catalogId).toBe("elasticsearch");
    expect((catalogs?.es1?.properties as Record<string, unknown>)?.connectionId).toBe("550e8400-e29b-41d4-a716-446655440020");
  });

  it("completed notification engineState", () => {
    const notification = readFixture("notification-query-completed.json");
    assertEnvelopeBase(notification);
    expect(notification.method).toBe("queryengine.completed");
    const params = notification.params as Record<string, unknown>;
    expect(params.engineState).toBeDefined();
    expect(params.engineStatePatch).toBeUndefined();
  });

  it("Payloadbuilder completed notification engineState", () => {
    const notification = readFixture("notification-query-completed-payloadbuilder.json");
    assertEnvelopeBase(notification);
    const params = notification.params as Record<string, unknown>;
    expect(params.engineState).toBeDefined();
    const es = params.engineState as Record<string, unknown>;
    expect(typeof es.payloadbuilder).toBe("object");
  });

  it("notification fixtures", () => {
    const progress = readFixture("notification-query-progress.json");
    assertEnvelopeBase(progress);
    expect(progress.type).toBe("notification");
    expect(progress.method).toBe("queryengine.progress");

    const chunk = readFixture("notification-query-result-chunk.json");
    assertEnvelopeBase(chunk);
    expect(chunk.method).toBe("queryengine.resultChunk");

    const failed = readFixture("notification-query-failed.json");
    assertEnvelopeBase(failed);
    expect(failed.method).toBe("queryengine.failed");

    const fileChange = readFixture("notification-file-change.json");
    assertEnvelopeBase(fileChange);
    expect(fileChange.method).toBe("file.change");
  });
});
