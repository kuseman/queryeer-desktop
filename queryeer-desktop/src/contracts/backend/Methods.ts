export type BackendRequestMethod =
  | "backend.handshake"
  | "backend.runtimeStatus"
  | "security.session.open"
  | "security.session.close"
  | "security.vault.changed"
  | "health.ping"
  | "query.execute"
  | "query.cancel"
  | "engine.invoke"
  | "connection.upsert"
  | "file.open"
  | "file.close"
  | "file.bind";

export type BackendNotificationMethod =
  | "query.progress"
  | "query.chunkStart"
  | "query.chunkRows"
  | "query.completed"
  | "query.failed"
  | "file.change";
