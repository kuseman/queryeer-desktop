export type BackendRequestMethod =
  | "backend.handshake"
  | "backend.runtimeStatus"
  | "health.ping"
  | "query.execute"
  | "query.cancel"
  | "connection.upsert"
  | "credential.store"
  | "file.open"
  | "file.close"
  | "file.bind";

export type BackendNotificationMethod =
  | "query.progress"
  | "query.resultChunk"
  | "query.completed"
  | "query.failed"
  | "file.change";
