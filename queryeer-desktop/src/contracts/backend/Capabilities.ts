import type { Capability } from "./Types";

export const BACKEND_REQUEST_CAPABILITIES: ReadonlyArray<Capability> = [
  "backend.runtimeStatus",
  "health.ping",
  "query.execute",
  "query.cancel",
  "connection.upsert",
  "credential.store"
];

export const BACKEND_NOTIFICATION_CAPABILITIES: ReadonlyArray<Capability> = [
  "query.progress",
  "query.resultChunk",
  "query.completed",
  "query.failed"
];

export const BACKEND_DEFAULT_REQUESTED_CAPABILITIES: ReadonlyArray<Capability> = [
  ...BACKEND_REQUEST_CAPABILITIES,
  ...BACKEND_NOTIFICATION_CAPABILITIES
];
