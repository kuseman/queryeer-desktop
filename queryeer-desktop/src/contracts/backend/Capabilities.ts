import type { Capability } from "./Types.js";

export const BACKEND_REQUEST_CAPABILITIES: ReadonlyArray<Capability> = [
  "backend.runtimeStatus",
  "security.session.open",
  "security.session.close",
  "security.vault.changed",
  "health.ping",
  "queryengine.execute",
  "queryengine.cancel",
  "queryengine.invoke",
  "file.open",
  "file.close"
];

export const BACKEND_NOTIFICATION_CAPABILITIES: ReadonlyArray<Capability> = [
  "queryengine.progress",
  "queryengine.chunkStart",
  "queryengine.chunkRows",
  "queryengine.completed",
  "queryengine.failed",
  "file.change",
  "settings.module.changed"
];

export const BACKEND_DEFAULT_REQUESTED_CAPABILITIES: ReadonlyArray<Capability> = [
  ...BACKEND_REQUEST_CAPABILITIES,
  ...BACKEND_NOTIFICATION_CAPABILITIES
];
