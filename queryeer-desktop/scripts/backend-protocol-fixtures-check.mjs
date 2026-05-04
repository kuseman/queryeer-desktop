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
  assert(request.method === "queryengine.execute", "Unexpected execute method");
  assert(request.id === response.id, "Execute request/response id mismatch");
  assert(response.result && typeof response.result === "object", "Execute response result is missing");
  assert(request.params?.queryExecutionId === response.result?.queryExecutionId, "Execute queryExecutionId mismatch");
  assert(typeof request.params?.fileId === "string", "Execute fileId must be string");
  assert(typeof request.params?.engineId === "string", "Execute engineId must be string");
  assert(typeof request.params?.text === "string", "Execute text must be string");
  assert(request.params.engineState !== undefined, "Execute engineState must be present");
  assert(request.params.parameters === undefined, "Execute must NOT have parameters field");
};

const testCancelFixtures = () => {
  const request = readFixture("request-query-cancel.json");
  const response = readFixture("response-query-cancel.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.type === "request", "Cancel request fixture must be request");
  assert(response.type === "response", "Cancel response fixture must be response");
  assert(request.method === "queryengine.cancel", "Unexpected cancel method");
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

const testFileOpenFixtures = () => {
  const request = readFixture("request-file-open.json");
  const response = readFixture("response-file-open.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.method === "file.open", "Unexpected file.open method");
  assert(request.id === response.id, "file.open request/response id mismatch");
  assert(typeof request.params?.fileId === "string", "file.open fileId missing");
  assert(typeof request.params?.uri === "string", "file.open uri missing");
  assert(typeof request.params?.mimeType === "string", "file.open mimeType missing");
  assert(request.params.fileId === response.result?.fileId, "file.open fileId mismatch");
  assert(typeof response.result?.backendVersion === "number", "file.open backendVersion missing");
};

const testFileCloseFixtures = () => {
  const request = readFixture("request-file-close.json");
  const response = readFixture("response-file-close.json");

  assertEnvelopeBase(request);
  assertEnvelopeBase(response);
  assert(request.method === "file.close", "Unexpected file.close method");
  assert(request.id === response.id, "file.close request/response id mismatch");
  assert(request.params?.fileId === response.result?.fileId, "file.close fileId mismatch");
  assert(response.result?.accepted === true, "file.close accepted must be true");
};

const testJdbcEngineStateFixture = () => {
  const request = readFixture("request-query-execute-jdbc.json");

  assertEnvelopeBase(request);
  assert(request.method === "queryengine.execute", "Unexpected method for JDBC execute");
  assert(typeof request.params?.engineState === "object", "JDBC engineState must be present");
  assert(request.params.engineState.connectionId === "550e8400-e29b-41d4-a716-446655440010", "JDBC engineState.connectionId mismatch");
};

const testPayloadbuilderEngineStateFixture = () => {
  const request = readFixture("request-query-execute-payloadbuilder.json");

  assertEnvelopeBase(request);
  assert(request.method === "queryengine.execute", "Unexpected method for PB execute");
  assert(typeof request.params?.engineState === "object", "PB engineState must be present");
  assert(request.params.engineState.defaultAlias === "es1", "PB engineState.defaultAlias mismatch");
  assert(typeof request.params.engineState.catalogs === "object", "PB engineState.catalogs missing");
  assert(request.params.engineState.catalogs.es1.catalogId === "elasticsearch", "PB catalogId mismatch");
  assert(request.params.engineState.catalogs.es1.properties.connectionId === "550e8400-e29b-41d4-a716-446655440020", "PB connectionId mismatch");
};

const testCompletedNotificationEngineState = () => {
  const notification = readFixture("notification-query-completed.json");

  assertEnvelopeBase(notification);
  assert(notification.method === "queryengine.completed", "Unexpected completed notification method");
  assert(notification.params.engineState !== undefined, "Completed notification engineState must be present");
  assert(notification.params.engineStatePatch === undefined, "Completed notification must NOT have engineStatePatch");

  const pbNotif = readFixture("notification-query-completed-payloadbuilder.json");
  assert(pbNotif.params.engineState !== undefined, "PB completed engineState must be present");
  assert(typeof pbNotif.params.engineState.payloadbuilder === "object", "PB completed engineState.payloadbuilder missing");
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
testFileOpenFixtures();
testFileCloseFixtures();
testJdbcEngineStateFixture();
testPayloadbuilderEngineStateFixture();
testCompletedNotificationEngineState();
testNotificationFixture("notification-query-progress.json", "queryengine.progress");
testNotificationFixture("notification-query-result-chunk.json", "queryengine.resultChunk");
testNotificationFixture("notification-query-failed.json", "queryengine.failed");
testNotificationFixture("notification-file-change.json", "file.change");
