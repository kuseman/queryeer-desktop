export type BackendRequestMethod =
  | "backend.handshake"
  | "backend.runtimeStatus"
  | "health.ping"
  | "query.execute"
  | "query.cancel"
  | "engine.invoke"
  | "connection.upsert"
  | "credential.store"
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
