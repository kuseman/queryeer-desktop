import { readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const BACKEND_PROTOCOL_VERSION = "1.0.0";
const FIXTURE_DIR = join(process.cwd(), "..", "protocol-fixtures", "backend");

const readFixture = (name) => {
  const file = join(FIXTURE_DIR, name);
  return JSON.parse(readFileSync(file, "utf8"));
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEnvelopeBase = (envelope) => {
  assert(
    envelope.protocolVersion === BACKEND_PROTOCOL_VERSION,
    `Unexpected protocolVersion: ${String(envelope.protocolVersion)}`
  );
  assert(
    envelope.type === "request" || envelope.type === "response" || envelope.type === "notification",
    `Unexpected envelope type: ${String(envelope.type)}`
  );
};

const testHandshakeFixtures = () => {
  const request = readFixture("request-handshake.json");
  const response = readFixture("response-handshake.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Handshake request fixture must be request");
  assert(response.type === "response", "Handshake response fixture must be response");
  assert(request.method === "backend.handshake", "Unexpected handshake method");
  assert(request.id === response.id, "Handshake request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Handshake response result is missing");
};

const testPingFixtures = () => {
  const request = readFixture("request-ping.json");
  const response = readFixture("response-ping.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Ping request fixture must be request");
  assert(response.type === "response", "Ping response fixture must be response");
  assert(request.method === "health.ping", "Unexpected ping method");
  assert(request.id === response.id, "Ping request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Ping response result is missing");
};

const testRuntimeStatusFixtures = () => {
  const request = readFixture("request-runtime-status.json");
  const response = readFixture("response-runtime-status.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Runtime status request fixture must be request");
  assert(response.type === "response", "Runtime status response fixture must be response");
  assert(request.method === "backend.runtimeStatus", "Unexpected runtime status method");
  assert(request.id === response.id, "Runtime status request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Runtime status result is missing");
  assert(Array.isArray(response.result.pluginStatuses), "runtimeStatus pluginStatuses must be array");
};

const testExecuteFixtures = () => {
  const request = readFixture("request-query-execute.json");
  const response = readFixture("response-query-execute.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Execute request fixture must be request");
  assert(response.type === "response", "Execute response fixture must be response");
  assert(request.method === "query.execute", "Unexpected execute method");
  assert(request.id === response.id, "Execute request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Execute response result is missing");
  assert(request.params?.queryExecutionId === response.result?.queryExecutionId, "Execute queryExecutionId mismatch");
};

const testCancelFixtures = () => {
  const request = readFixture("request-query-cancel.json");
  const response = readFixture("response-query-cancel.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Cancel request fixture must be request");
  assert(response.type === "response", "Cancel response fixture must be response");
  assert(request.method === "query.cancel", "Unexpected cancel method");
  assert(request.id === response.id, "Cancel request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Cancel response result is missing");
  assert(request.params?.queryExecutionId === response.result?.queryExecutionId, "Cancel queryExecutionId mismatch");
};

const testConnectionUpsertFixtures = () => {
  const request = readFixture("request-connection-upsert.json");
  const response = readFixture("response-connection-upsert.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Connection upsert request fixture must be request");
  assert(response.type === "response", "Connection upsert response fixture must be response");
  assert(request.method === "connection.upsert", "Unexpected connection.upsert method");
  assert(request.id === response.id, "Connection upsert request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Connection upsert result is missing");
  assert(typeof response.result.connectionId === "string", "connection.upsert connectionId missing");
};

const testCredentialStoreFixtures = () => {
  const request = readFixture("request-credential-store.json");
  const response = readFixture("response-credential-store.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Credential store request fixture must be request");
  assert(response.type === "response", "Credential store response fixture must be response");
  assert(request.method === "credential.store", "Unexpected credential.store method");
  assert(request.id === response.id, "Credential store request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Credential store result is missing");
  assert(request.params?.connectionId === response.result?.connectionId, "Credential store connectionId mismatch");
};

const testNotificationFixture = (name, method) => {
  const notification = readFixture(name);
  assertEnvelopeBase(notification);
  assert(notification.type === "notification", `${name} must be notification`);
  assert(notification.method === method, `Unexpected notification method in ${name}`);
  assert(notification.params && typeof notification.params === "object", `${name} params are missing`);
};

testHandshakeFixtures();
testRuntimeStatusFixtures();
testPingFixtures();
testExecuteFixtures();
testCancelFixtures();
testConnectionUpsertFixtures();
testCredentialStoreFixtures();
testNotificationFixture("notification-query-progress.json", "query.progress");
testNotificationFixture("notification-query-result-chunk.json", "query.resultChunk");
testNotificationFixture("notification-query-completed.json", "query.completed");
testNotificationFixture("notification-query-failed.json", "query.failed");
