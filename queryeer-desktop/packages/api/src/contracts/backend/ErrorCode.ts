export type BackendErrorCode =
  | "VALIDATION"
  | "METHOD_NOT_FOUND"
  | "UNSUPPORTED_PROTOCOL"
  | "ENGINE_NOT_FOUND"
  | "QUERY_NOT_FOUND"
  | "LARGE_VALUE_NOT_FOUND"
  | "TIMEOUT"
  | "CANCELLED"
  | "SECURITY_SESSION_CLOSED"
  | "INTERNAL";

export type BackendError = {
  code: BackendErrorCode;
  message: string;
  details?: Record<string, unknown>;
};
