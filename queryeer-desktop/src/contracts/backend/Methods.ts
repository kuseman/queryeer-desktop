export type BackendRequestMethod =
  | "backend.handshake"
  | "backend.runtimeStatus"
  | "health.ping"
  | "query.execute"
  | "query.cancel"
  | "connection.upsert"
  | "credential.store";

export type BackendNotificationMethod =
  | "query.progress"
  | "query.resultChunk"
  | "query.completed"
  | "query.failed";
