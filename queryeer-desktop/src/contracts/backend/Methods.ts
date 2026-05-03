export type BackendRequestMethod =
  | "backend.handshake"
  | "backend.runtimeStatus"
  | "security.session.open"
  | "security.session.close"
  | "security.vault.changed"
  | "health.ping"
  | "queryengine.execute"
  | "queryengine.cancel"
  | "queryengine.invoke"
  | "connection.upsert"
  | "file.open"
  | "file.close"
  | "file.bind";

export type BackendNotificationMethod =
  | "queryengine.progress"
  | "queryengine.chunkStart"
  | "queryengine.chunkRows"
  | "queryengine.completed"
  | "queryengine.failed"
  | "file.change";
