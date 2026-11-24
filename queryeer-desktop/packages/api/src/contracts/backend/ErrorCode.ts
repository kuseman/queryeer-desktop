export type BackendErrorCode =
  | "VALIDATION"
  | "METHOD_NOT_FOUND"
  | "UNSUPPORTED_PROTOCOL"
  | "ENGINE_NOT_FOUND"
  | "ACTION_NOT_FOUND"
  | "QUERY_NOT_FOUND"
  | "LARGE_VALUE_NOT_FOUND"
  | "TIMEOUT"
  | "CANCELLED"
  | "SECURITY_SESSION_CLOSED"
  /** The backend stopped while the query ran; set by the desktop, not sent by the backend. */
  | "BACKEND_RESTARTED"
  | "INTERNAL";

export type BackendError = {
  code: BackendErrorCode;
  message: string;
  details?: Record<string, unknown>;
};
