import type { Capability } from "./Types.js";

export const BACKEND_REQUEST_CAPABILITIES: ReadonlyArray<Capability> = [
  "backend.runtimeStatus",
  "health.ping",
  "query.execute",
  "query.cancel",
  "engine.invoke",
  "connection.upsert",
  "credential.store",
  "file.open",
  "file.close",
  "file.bind"
];

export const BACKEND_NOTIFICATION_CAPABILITIES: ReadonlyArray<Capability> = [
  "query.progress",
  "query.chunkStart",
  "query.chunkRows",
  "query.completed",
  "query.failed",
  "file.change"
];

export const BACKEND_DEFAULT_REQUESTED_CAPABILITIES: ReadonlyArray<Capability> = [
  ...BACKEND_REQUEST_CAPABILITIES,
  ...BACKEND_NOTIFICATION_CAPABILITIES
];
